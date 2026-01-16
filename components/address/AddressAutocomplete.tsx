'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import debounce from 'lodash.debounce';
import {
  MapboxAutocompleteService,
  type AddressSuggestion,
  type UserLocation,
} from '@/lib/services/MapboxAutocompleteService';

interface AddressAutocompleteProps {
  value: string;
  onSelect: (suggestion: AddressSuggestion) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AddressAutocomplete({
  value,
  onSelect,
  onChange,
  placeholder = 'Enter a starting address',
  disabled = false,
  className,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get user location on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        // User denied or error - continue without proximity
        console.log('Geolocation not available:', error.message);
      },
      {
        timeout: 5000,
        maximumAge: 60000, // Cache for 1 minute
      }
    );
  }, []);

  // Debounced search function
  const debouncedSearch = useMemo(
    () =>
      debounce(async (query: string, proximity: UserLocation | null) => {
        // Cancel previous request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        // Minimum 3 characters
        if (query.trim().length < 3) {
          setSuggestions([]);
          setIsLoading(false);
          return;
        }

        // Create new abort controller
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setIsLoading(true);
        setError(null);

        try {
          const results = await MapboxAutocompleteService.searchAddresses(
            query,
            proximity || undefined,
            abortController.signal
          );

          // Check if request was aborted
          if (abortController.signal.aborted) {
            return;
          }

          setSuggestions(results);
        } catch (err) {
          // Don't set error for aborted requests
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }

          // Set error for other failures
          const errorMessage = err instanceof Error ? err.message : 'Failed to search addresses';
          setError(errorMessage);
          setSuggestions([]);
        } finally {
          if (!abortController.signal.aborted) {
            setIsLoading(false);
          }
        }
      }, 400),
    []
  );

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, [debouncedSearch]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Show dropdown if there's text
    if (newValue.trim().length > 0) {
      setShowDropdown(true);
    }

    // Trigger search if length > 2
    if (newValue.trim().length > 2) {
      debouncedSearch(newValue, userLocation);
    } else {
      setSuggestions([]);
      setIsLoading(false);
    }
  };

  const handleSelect = (suggestion: AddressSuggestion) => {
    // Format address for display
    const displayValue = suggestion.subtitle
      ? `${suggestion.title}, ${suggestion.subtitle}`
      : suggestion.title;

    onChange(displayValue);
    setShowDropdown(false);
    setSuggestions([]);
    setError(null);
    onSelect(suggestion);
  };

  const handleBlur = () => {
    // Delay hiding dropdown to allow clicks on suggestions
    blurTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  };

  const handleFocus = () => {
    // Clear any pending blur timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }

    // Show dropdown if there are suggestions
    if (suggestions.length > 0 || value.trim().length > 2) {
      setShowDropdown(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
    } else if (e.key === 'Enter' && suggestions.length > 0) {
      // Select first suggestion on Enter
      handleSelect(suggestions[0]);
    }
  };

  return (
    <div className={`relative w-full ${className || ''}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}

      {showDropdown && (suggestions.length > 0 || isLoading) && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 w-full bg-white/95 backdrop-blur-sm shadow-xl rounded-xl border border-gray-100 overflow-hidden">
          {isLoading && suggestions.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">
              Searching...
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="max-h-[400px] overflow-y-auto">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => handleSelect(suggestion)}
                  className="w-full p-3 hover:bg-gray-50 cursor-pointer flex items-start gap-3 text-left transition-colors"
                  onMouseDown={(e) => {
                    // Prevent input blur when clicking suggestion
                    e.preventDefault();
                  }}
                >
                  <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm">
                      {suggestion.title}
                    </div>
                    {suggestion.subtitle && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {suggestion.subtitle}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!isLoading && suggestions.length === 0 && value.trim().length > 2 && (
            <div className="p-4 text-center text-sm text-gray-500">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
