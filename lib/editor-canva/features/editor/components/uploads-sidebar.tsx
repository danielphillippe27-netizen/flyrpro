"use client";

import Image from "next/image";
import { AlertTriangle, Loader, Upload } from "lucide-react";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";

import { useGetImages } from "@/lib/editor-canva/features/images/api/use-get-images";

import { cn } from "@/lib/editor-canva/lib/utils";
import { UploadButton } from "@/lib/editor-canva/lib/uploadthing";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";

interface UploadsSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
}

export const UploadsSidebar = ({ editor, activeTool, onChangeActiveTool }: UploadsSidebarProps) => {
  const { data, isLoading, isError } = useGetImages();

  const onClose = () => {
    onChangeActiveTool("select");
  };

  const handleImageClick = (url: string) => {
    editor?.addImage(url);
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "uploads" ? "visible" : "hidden"
      )}
    >
      <ToolSidebarHeader 
        title="Uploads" 
        description="Your uploaded assets library" 
        onClose={onClose}
      />
      <div className="p-4 border-b">
        <UploadButton
          appearance={{
            button: "w-full text-sm font-medium",
            allowedContent: "hidden",
          }}
          content={{
            button: "Upload File",
          }}
          endpoint="imageUploader"
          onClientUploadComplete={(res) => {
            if (res && res[0]) {
              editor?.addImage(res[0].url);
            }
          }}
        />
      </div>
      {isLoading && (
        <div className="flex items-center justify-center flex-1">
          <Loader className="size-4 text-muted-foreground animate-spin" />
        </div>
      )}
      {isError && (
        <div className="flex flex-col gap-y-4 items-center justify-center flex-1">
          <AlertTriangle className="size-4 text-muted-foreground" />
          <p className="text-muted-foreground text-xs">Failed to fetch uploads</p>
        </div>
      )}
      <ScrollArea>
        <div className="p-4">
          {data && data.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {data.map((image) => (
                <button
                  key={image.id}
                  onClick={() => handleImageClick(image.url)}
                  className="relative aspect-square rounded-md overflow-hidden border border-gray-200 hover:border-blue-500 transition-colors group"
                >
                  <Image
                    src={image.url}
                    alt={image.name || "Upload"}
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            !isLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Upload className="size-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  No uploads yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload files to see them here
                </p>
              </div>
            )
          )}
        </div>
      </ScrollArea>
    </aside>
  );
};




