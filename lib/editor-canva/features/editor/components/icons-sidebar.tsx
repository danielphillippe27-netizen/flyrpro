"use client";

import { useState, useEffect } from "react";
import { Search, Loader, AlertTriangle, Crown } from "lucide-react";
import debounce from "lodash.debounce";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";
import { useGetIcons } from "@/lib/editor-canva/features/icons/api/use-get-icons";

import { cn } from "@/lib/editor-canva/lib/utils";
import { Input } from "@/lib/editor-canva/components/ui/input";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";

interface IconsSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const IconsSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: IconsSidebarProps) => {
  const [searchQuery, setSearchQuery] = useState("icon");
  const [debouncedQuery, setDebouncedQuery] = useState("icon");

  const { data, isLoading, isError, error } = useGetIcons({
    query: debouncedQuery,
    page: 1,
    perPage: 30,
    enabled: activeTool === "icons",
  });

  // Debounce search query
  useEffect(() => {
    const debounced = debounce((value: string) => {
      setDebouncedQuery(value || "icon");
    }, 500);

    debounced(searchQuery);

    return () => {
      debounced.cancel();
    };
  }, [searchQuery]);

  const onClose = () => {
    onChangeActiveTool("select");
  };

  const handleIconClick = (iconUrl: string) => {
    editor?.addImage(iconUrl);
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "icons" ? "visible" : "hidden",
      )}
    >
      <ToolSidebarHeader
        title="Icons"
        description="Add icons from Freepik to your canvas"
      />
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search icons..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {isLoading && (
        <div className="flex items-center justify-center flex-1">
          <Loader className="size-4 text-muted-foreground animate-spin" />
        </div>
      )}
      {isError && (
        <div className="flex flex-col gap-y-4 items-center justify-center flex-1">
          <AlertTriangle className="size-4 text-muted-foreground" />
          <p className="text-muted-foreground text-xs text-center px-4">
            {error instanceof Error ? error.message : "Failed to fetch icons"}
          </p>
          {error instanceof Error && error.message.includes("API key") && (
            <p className="text-muted-foreground text-xs text-center px-4">
              Please configure FREEPIK or FREEPIK_API_KEY in your environment variables.
            </p>
          )}
        </div>
      )}
      {!isLoading && !isError && data && (
        <ScrollArea>
          <div className="p-4">
            {data.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  No icons found
                </p>
                <p className="text-xs text-muted-foreground">
                  Try a different search term
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 text-xs text-muted-foreground">
                  {data.meta.total} icons found
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {data.data.map((icon) => (
                    <button
                      key={icon.id}
                      onClick={() => handleIconClick(icon.downloadUrl)}
                      className="relative aspect-square border rounded-lg hover:bg-muted transition-colors flex items-center justify-center group"
                      title={icon.name}
                    >
                      <img
                        src={icon.previewUrl}
                        alt={icon.name || icon.description}
                        className="w-full h-full object-contain p-2"
                        loading="lazy"
                      />
                      {icon.premium && (
                        <div className="absolute top-1 right-1">
                          <Crown className="size-3 text-amber-500" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors rounded-lg" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      )}
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};
