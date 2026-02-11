"""
CVRP (Capacitated Vehicle Routing Problem) Lambda for FLYR-PRO

Optimizes walking routes with capacity constraints for fair territory splitting.
Handles both single-agent (TSP) and multi-agent (CVRP) scenarios.

Environment Variables:
- VALHALLA_API_KEY: Stadia Maps API key for pedestrian distance matrix
- VALHALLA_BASE_URL: Default: https://api.stadiamaps.com
- CVRP_LAMBDA_SECRET: Required. Must match CVRP_LAMBDA_SECRET in your app .env.local.
  (If unset, no auth is required - for local dev only. Set it in production.)
"""

import json
import os
import requests
from typing import List, Dict, Tuple, Optional, Union
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

# Configuration
VALHALLA_API_KEY = os.environ.get('VALHALLA_API_KEY')
VALHALLA_BASE_URL = os.environ.get('VALHALLA_BASE_URL', 'https://api.stadiamaps.com')
CVRP_LAMBDA_SECRET = os.environ.get('CVRP_LAMBDA_SECRET', '').strip()


def handler(event, context):
    """
    Lambda handler for CVRP routing optimization.
    
    Expected event body:
    {
        "addresses": [
            {"id": "uuid-1", "lat": 43.7, "lon": -79.4, "house_number": "123", "street_name": "Main St"},
            ...
        ],
        "n_agents": 5,  # Number of canvassers/agents
        "depot": {"lat": 43.7, "lon": -79.4},  # Starting point (optional, defaults to first address)
        "options": {
            "max_houses_per_agent": null,  # Auto-calculated if null
            "walking_speed": 5.0,  # km/h
            "balance_factor": 1.0,  # 0.0-2.0, higher = more equal splitting
            "street_side_bias": true,  # Pre-sort by odd/even house numbers
            "return_to_depot": true  # Round trip vs one-way
        }
    }
    
    Returns:
    {
        "success": True,
        "clusters": [
            {
                "agent_id": 0,
                "addresses": [
                    {
                        "id": "uuid-1",
                        "sequence": 1,
                        "walk_time_sec": 0,
                        "distance_m": 0,
                        ...
                    }
                ],
                "total_time_sec": 3600,
                "total_distance_m": 2500,
                "n_addresses": 50
            }
        ],
        "matrix_time_sec": 45.2  # How long Valhalla call took
    }
    """
    try:
        # Auth: require CVRP_LAMBDA_SECRET to match header (when secret is set in Lambda)
        if CVRP_LAMBDA_SECRET:
            headers = event.get('headers') or {}
            # Lambda may pass headers lowercase or with different casing
            got = (
                headers.get('x-cvrp-secret') or
                headers.get('X-Cvrp-Secret') or
                headers.get('x-slice-secret') or
                headers.get('X-Slice-Secret') or
                ''
            )
            if isinstance(got, str):
                got = got.strip()
            else:
                got = ''
            if got != CVRP_LAMBDA_SECRET:
                return _response(401, {'ok': False, 'error': 'unauthorized'})

        # Parse request
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', event)
        
        addresses = body.get('addresses', [])
        n_agents = body.get('n_agents', 1)
        depot = body.get('depot')
        options = body.get('options', {})
        
        if len(addresses) < 2:
            return _response(400, {'error': 'Need at least 2 addresses'})
        
        if not VALHALLA_API_KEY:
            return _response(500, {'error': 'VALHALLA_API_KEY not configured'})
        
        # Set defaults
        max_houses = options.get('max_houses_per_agent')
        if max_houses is None:
            max_houses = int(len(addresses) / n_agents) + 1
        
        walking_speed = options.get('walking_speed', 5.0)
        street_side_bias = options.get('street_side_bias', True)
        return_to_depot = options.get('return_to_depot', True)
        
        print(f"[CVRP] Optimizing {len(addresses)} addresses for {n_agents} agents")
        print(f"[CVRP] Max houses per agent: {max_houses}")
        
        # Pre-sort by street side if enabled (the "Lazy Walker" hack)
        if street_side_bias:
            addresses = _sort_by_street_side(addresses)
        
        # Get distance matrix
        print("[CVRP] Calculating distance matrix...")
        matrix_data = _get_distance_matrix(addresses, depot, walking_speed)
        
        if not matrix_data:
            return _response(500, {'error': 'Failed to compute distance matrix'})
        
        # Solve CVRP
        print("[CVRP] Solving CVRP with OR-Tools...")
        solution, manager, routing = _solve_cvrp(
            matrix_data['time_matrix'],
            matrix_data['distance_matrix'],
            n_agents,
            max_houses,
            return_to_depot
        )
        
        if not solution:
            return _response(500, {'error': 'CVRP solver failed to find solution'})
        
        # Format response
        clusters = _format_solution(
            solution,
            manager,
            routing,
            addresses,
            matrix_data['time_matrix'],
            matrix_data['distance_matrix'],
            n_agents
        )
        
        return _response(200, {
            'success': True,
            'clusters': clusters,
            'matrix_time_sec': matrix_data.get('elapsed_ms', 0) / 1000,
            'summary': {
                'n_addresses': len(addresses),
                'n_agents': n_agents,
                'avg_houses_per_agent': len(addresses) / n_agents,
                'max_houses_per_agent': max_houses,
                'total_walk_time_min': sum(c['total_time_sec'] for c in clusters) / 60,
                'total_distance_km': sum(c['total_distance_m'] for c in clusters) / 1000
            }
        })
        
    except Exception as e:
        print(f"[CVRP] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return _response(500, {'error': str(e)})


def _sort_by_street_side(addresses: List[Dict]) -> List[Dict]:
    """
    Pre-sort addresses by street side (odd/even) to encourage contiguous walking.
    The "Lazy Walker" hack - keeps agents on one side of the street.
    """
    def sort_key(addr):
        street = addr.get('street_name', '')
        house_num = addr.get('house_number', '0')
        try:
            # Extract numeric part from house number
            num = int(''.join(filter(str.isdigit, str(house_num))) or '0')
            is_odd = num % 2
        except:
            is_odd = 0
        return (street, is_odd, house_num)
    
    return sorted(addresses, key=sort_key)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters. More accurate than Euclidean for routing."""
    import math
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _get_distance_matrix(
    addresses: List[Dict],
    depot: Optional[Dict],
    walking_speed: float
) -> Optional[Dict]:
    """
    Calculate distance matrix using Haversine (great-circle) distance.
    More accurate than Euclidean for real walking routes; solver minimizes
    travel time so routes are faster and less backtracking.
    """
    import time
    start_time = time.time()
    
    # Build list of locations (depot first if provided)
    locations = []
    depot_index = 0
    
    if depot:
        locations.append({'lat': depot['lat'], 'lon': depot['lon']})
    
    for addr in addresses:
        locations.append({'lat': addr['lat'], 'lon': addr['lon']})
    
    # Walking speed: km/h -> m/s (e.g. 5 km/h = 1.39 m/s)
    speed_m_s = walking_speed * 1000 / 3600
    
    time_matrix = []
    distance_matrix = []
    
    for i, from_loc in enumerate(locations):
        time_row = []
        dist_row = []
        for j, to_loc in enumerate(locations):
            if i == j:
                time_row.append(0)
                dist_row.append(0)
            else:
                dist = _haversine_m(
                    from_loc['lat'], from_loc['lon'],
                    to_loc['lat'], to_loc['lon']
                )
                walk_time = dist / speed_m_s
                time_row.append(int(walk_time))
                dist_row.append(int(dist))
        
        time_matrix.append(time_row)
        distance_matrix.append(dist_row)
    
    elapsed = (time.time() - start_time) * 1000
    print(f"[CVRP] Calculated {len(locations)}x{len(locations)} Haversine matrix in {elapsed:.0f}ms")
    
    return {
        'time_matrix': time_matrix,
        'distance_matrix': distance_matrix,
        'depot_index': depot_index,
        'elapsed_ms': elapsed
    }


def _solve_cvrp(
    time_matrix: List[List[int]],
    distance_matrix: List[List[int]],
    n_agents: int,
    max_houses: int,
    return_to_depot: bool
) -> Tuple[Optional[pywrapcp.Assignment], Optional[pywrapcp.RoutingIndexManager], Optional[pywrapcp.RoutingModel]]:
    """
    Solve the CVRP using OR-Tools.
    """
    n_locations = len(time_matrix)
    
    # Create routing index manager
    # (n_locations, n_vehicles, depot_index)
    manager = pywrapcp.RoutingIndexManager(n_locations, n_agents, 0)
    routing = pywrapcp.RoutingModel(manager)
    
    # Create time callback
    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return time_matrix[from_node][to_node]
    
    transit_callback_index = routing.RegisterTransitCallback(time_callback)
    
    # Create distance callback (for tracking, not optimizing)
    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]
    
    distance_callback_index = routing.RegisterTransitCallback(distance_callback)
    
    # Set arc cost (what we optimize for - minimize total walking time)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    
    # Add capacity constraint (fair splitting)
    def demand_callback(from_index):
        from_node = manager.IndexToNode(from_index)
        # Depot has 0 demand, all others have 1
        return 0 if from_node == 0 else 1
    
    demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
    
    routing.AddDimensionWithVehicleCapacity(
        demand_callback_index,
        0,  # null capacity slack
        [max_houses] * n_agents,  # Capacity for each vehicle
        True,  # fix start cumul to zero
        'Capacity'
    )
    
    # Add time dimension (to track cumulative walk time)
    routing.AddDimension(
        transit_callback_index,
        0,  # no slack
        14400,  # max 4 hours per route
        True,  # fix start cumul to zero
        'Time'
    )
    
    time_dimension = routing.GetDimensionOrDie('Time')
    
    # Allow dropping nodes (with high penalty - we want to visit all)
    penalty = 1000000
    for node in range(1, n_locations):
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)
    
    # Search parameters
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_parameters.time_limit.FromSeconds(10)  # 10 second limit
    search_parameters.solution_limit = 1  # Stop after first solution
    search_parameters.log_search = False
    
    # Solve
    solution = routing.SolveWithParameters(search_parameters)
    
    if solution:
        print(f"[CVRP] Solution found! Objective value: {solution.ObjectiveValue()}")
        return solution, manager, routing
    else:
        print("[CVRP] No solution found")
        return None, None, None


def _format_solution(
    solution: pywrapcp.Assignment,
    manager: pywrapcp.RoutingIndexManager,
    routing: pywrapcp.RoutingModel,
    addresses: List[Dict],
    time_matrix: List[List[int]],
    distance_matrix: List[List[int]],
    n_agents: int
) -> List[Dict]:
    """
    Format OR-Tools solution into clusters for each agent with actual time/distance.
    """
    clusters = []
    
    for agent_id in range(n_agents):
        index = routing.Start(agent_id)
        agent_addresses = []
        sequence = 0
        cumulative_time = 0
        cumulative_dist = 0
        prev_node = 0  # Start at depot
        
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            
            if node != 0:  # Skip depot in output (node 0 is depot)
                addr_idx = node - 1
                if addr_idx < len(addresses):
                    addr = addresses[addr_idx].copy()
                    addr['sequence'] = sequence
                    addr['walk_time_sec'] = cumulative_time
                    addr['distance_m'] = cumulative_dist
                    agent_addresses.append(addr)
                    sequence += 1
            
            next_index = solution.Value(routing.NextVar(index))
            next_node = manager.IndexToNode(next_index)
            
            # Accumulate actual time/distance
            if not routing.IsEnd(next_index):
                cumulative_time += time_matrix[node][next_node]
                cumulative_dist += distance_matrix[node][next_node]
            
            index = next_index
        
        clusters.append({
            'agent_id': agent_id,
            'addresses': agent_addresses,
            'n_addresses': len(agent_addresses),
            'total_time_sec': cumulative_time,
            'total_distance_m': cumulative_dist,
            'estimated_walk_time_min': round(cumulative_time / 60)
        })
    
    return clusters


def _response(status_code: int, body: Dict) -> Dict:
    """Format Lambda HTTP response."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body)
    }


# For local testing
if __name__ == '__main__':
    # Test with sample data
    test_event = {
        'addresses': [
            {'id': '1', 'lat': 43.7, 'lon': -79.4, 'house_number': '100', 'street_name': 'Main St'},
            {'id': '2', 'lat': 43.701, 'lon': -79.401, 'house_number': '102', 'street_name': 'Main St'},
            {'id': '3', 'lat': 43.702, 'lon': -79.402, 'house_number': '104', 'street_name': 'Main St'},
            {'id': '4', 'lat': 43.703, 'lon': -79.403, 'house_number': '200', 'street_name': 'Oak Ave'},
            {'id': '5', 'lat': 43.704, 'lon': -79.404, 'house_number': '202', 'street_name': 'Oak Ave'},
        ],
        'n_agents': 2,
        'depot': {'lat': 43.7, 'lon': -79.4},
        'options': {
            'street_side_bias': True,
            'return_to_depot': True
        }
    }
    
    result = handler(test_event, None)
    print(json.dumps(result, indent=2))
