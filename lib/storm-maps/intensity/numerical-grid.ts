import { z } from 'zod';
import { connectedHailCells, hailCellsPolygon } from './hail-zone';
import { HAIL_THRESHOLDS } from '../intelligence/geometry';
const coordinate=z.tuple([z.number().min(-180).max(180),z.number().min(-85).max(85)]);
export const hailGridSchema=z.object({
 provider:z.literal('xweather'),datasetId:z.string().min(1).max(160),
 validFrom:z.iso.datetime({offset:true}),validTo:z.iso.datetime({offset:true}),
 sourceUpdatedAt:z.iso.datetime({offset:true}),units:z.literal('mm'),crs:z.literal('EPSG:4326'),
 layout:z.literal('south-to-north-row-major'),width:z.number().int().min(3).max(1024),
 height:z.number().int().min(3).max(1024),bounds:z.tuple([coordinate,coordinate]),
 resolutionMeters:z.number().positive(),values:z.array(z.number().min(0).max(200).nullable()).max(262144),
}).strict().superRefine((grid,ctx)=>{
 if(grid.width*grid.height!==grid.values.length)ctx.addIssue({code:'custom',message:'Grid dimensions do not match its values.'});
 if(grid.bounds[0][0]>=grid.bounds[1][0]||grid.bounds[0][1]>=grid.bounds[1][1])ctx.addIssue({code:'custom',message:'Invalid grid extent.'});
 if(Date.parse(grid.validFrom)>Date.parse(grid.validTo)||Date.parse(grid.validTo)-Date.parse(grid.validFrom)>7*86400000)ctx.addIssue({code:'custom',message:'Invalid hail aggregation window.'});
});
export type NumericalHailGrid=z.infer<typeof hailGridSchema>;
/** Exact thresholding of supplied numerical cells. Never interprets rendered colours.
 * Null cells adjacent to a selected component or clipped components reject the export.
 * Input conversion must preserve the source CRS, native cells and no-data mask.
 */
export function territoryFromHailGrid(raw:unknown,location:[number,number],minimum:number){
 const grid=hailGridSchema.parse(raw);
 if(!HAIL_THRESHOLDS.includes(minimum as typeof HAIL_THRESHOLDS[number]))throw Error('Choose a supported cumulative hail threshold.');
 const [[west,south],[east,north]]=grid.bounds;
 const x=Math.floor((location[0]-west)/(east-west)*grid.width),y=Math.floor((location[1]-south)/(north-south)*grid.height);
 if(x<0||y<0||x>=grid.width||y>=grid.height)throw Error('The selected point is outside the numerical grid.');
 const cells=connectedHailCells(grid.values,grid.width,grid.height,y*grid.width+x,minimum,null);
 for(const id of cells)for(const adjacent of [id-1,id+1,id-grid.width,id+grid.width])
  if(grid.values[adjacent]==null)throw Error('Unknown numerical cells touch the selected area. Complete grid coverage is required.');
 const boundary=hailCellsPolygon(cells,grid.width,grid.height,[west,south,east,north]).geometry;
 return {boundary,minimumMM:minimum,clickedMM:grid.values[y*grid.width+x],cellCount:cells.size,
 provenance:{provider:grid.provider,datasetId:grid.datasetId,validFrom:grid.validFrom,validTo:grid.validTo,sourceUpdatedAt:grid.sourceUpdatedAt,resolutionMeters:grid.resolutionMeters,method:'native-cell-cumulative-threshold',units:grid.units,crs:grid.crs}};
}
