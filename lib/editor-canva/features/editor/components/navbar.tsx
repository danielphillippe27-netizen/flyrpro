"use client";

import { CiFileOn } from "react-icons/ci";
import { BsCloudCheck, BsCloudSlash } from "react-icons/bs";
import { useFilePicker } from "use-file-picker";
import { useMutationState } from "@tanstack/react-query";
import { 
  ChevronDown, 
  Download, 
  Loader, 
  MousePointerClick, 
  Redo2, 
  Undo2,
  Crop,
  Square,
  Menu,
  Maximize2
} from "lucide-react";

import { UserButton } from "@/lib/editor-canva/features/auth/components/user-button";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { Logo } from "@/lib/editor-canva/features/editor/components/logo";
import { PrintSafetyIndicator } from "@/lib/editor-canva/features/editor/components/print-safety-indicator";
import { ResourceLinks } from "@/lib/editor-canva/features/editor/components/resource-links";

import { cn } from "@/lib/editor-canva/lib/utils";
import { Hint } from "@/lib/editor-canva/components/hint";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { Separator } from "@/lib/editor-canva/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/lib/editor-canva/components/ui/dropdown-menu";

interface NavbarProps {
  id: string;
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
  projectName?: string;
};

export const Navbar = ({
  id,
  editor,
  activeTool,
  onChangeActiveTool,
  projectName,
}: NavbarProps) => {
  const data = useMutationState({
    filters: {
      mutationKey: ["project", { id }],
      exact: true,
    },
    select: (mutation) => mutation.state.status,
  });

  const currentStatus = data[data.length - 1];

  const isError = currentStatus === "error";
  const isPending = currentStatus === "pending";

  const { openFilePicker } = useFilePicker({
    accept: ".json",
    onFilesSuccessfullySelected: ({ plainFiles }: any) => {
      if (plainFiles && plainFiles.length > 0) {
        const file = plainFiles[0];
        const reader = new FileReader();
        reader.readAsText(file, "UTF-8");
        reader.onload = () => {
          editor?.loadJson(reader.result as string);
        };
      }
    },
  });

  const canvasSizePresets = [
    { label: "8.5\" × 11\" Letter", width: 2550, height: 3300 },
    { label: "11\" × 8.5\" Landscape", width: 3300, height: 2550 },
    { label: "8.5\" × 5.5\" Half Letter", width: 2550, height: 1650 },
    { label: "5.5\" × 8.5\" Portrait", width: 1650, height: 2550 },
    { label: "1920 × 1080 Web", width: 1920, height: 1080 },
    { label: "1080 × 1920 Mobile", width: 1080, height: 1920 },
  ];

  const handleResize = (width: number, height: number) => {
    editor?.changeSize({ width, height });
  };

  return (
    <nav className="w-full flex items-center p-4 h-[68px] gap-x-8 border-b lg:pl-[34px]">
      <Hint label="Menu" side="bottom" sideOffset={10}>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
        >
          <Menu className="size-5" />
        </Button>
      </Hint>
      <Logo />
      <div className="w-full flex items-center gap-x-1 h-full">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              File
              <ChevronDown className="size-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            <DropdownMenuItem
              onClick={() => openFilePicker()}
              className="flex items-center gap-x-2"
            >
              <CiFileOn className="size-8" />
              <div>
                <p>Open</p>
                <p className="text-xs text-muted-foreground">
                  Open a JSON file
                </p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-2" />
        <Hint label="Select" side="bottom" sideOffset={10}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChangeActiveTool("select")}
            className={cn(activeTool === "select" && "bg-gray-100")}
          >
            <MousePointerClick className="size-4" />
          </Button>
        </Hint>
        <Hint label="Undo" side="bottom" sideOffset={10}>
          <Button
            disabled={!editor?.canUndo()}
            variant="ghost"
            size="icon"
            onClick={() => editor?.onUndo()}
          >
            <Undo2 className="size-4" />
          </Button>
        </Hint>
        <Hint label="Redo" side="bottom" sideOffset={10}>
          <Button
            disabled={!editor?.canRedo()}
            variant="ghost"
            size="icon"
            onClick={() => editor?.onRedo()}
          >
            <Redo2 className="size-4" />
          </Button>
        </Hint>
        <Separator orientation="vertical" className="mx-2" />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Resize
              <ChevronDown className="size-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            {canvasSizePresets.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onClick={() => handleResize(preset.width, preset.height)}
                className="flex flex-col items-start gap-y-1"
              >
                <p className="font-medium">{preset.label}</p>
                <p className="text-xs text-muted-foreground">
                  {preset.width} × {preset.height} px
                </p>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-2" />
        {isPending && ( 
          <div className="flex items-center gap-x-2">
            <Loader className="size-4 animate-spin text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              Saving...
            </div>
          </div>
        )}
        {!isPending && isError && ( 
          <div className="flex items-center gap-x-2">
            <BsCloudSlash className="size-[20px] text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              Failed to save
            </div>
          </div>
        )}
        {!isPending && !isError && ( 
          <div className="flex items-center gap-x-2">
            <BsCloudCheck className="size-[20px] text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              Saved
            </div>
          </div>
        )}
        {/* Centered title */}
        <div className="flex-1 flex justify-center">
          <h1 className="text-sm font-medium text-muted-foreground">
            {projectName || "Untitled design"}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-x-4">
          {/* Print Safety Indicator */}
          <PrintSafetyIndicator editor={editor} />
          <Separator orientation="vertical" className="mx-2" />
          {/* Bleed and Safe Zone Toggles */}
          <Hint label={editor?.showBleed ? "Hide Bleed" : "Show Bleed"} side="bottom" sideOffset={10}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => editor?.toggleBleed()}
              className={cn(editor?.showBleed && "bg-gray-100")}
            >
              <Crop className="size-4" />
            </Button>
          </Hint>
          <Hint label={editor?.showSafeZone ? "Hide Safe Zone" : "Show Safe Zone"} side="bottom" sideOffset={10}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => editor?.toggleSafeZone()}
              className={cn(editor?.showSafeZone && "bg-gray-100")}
            >
              <Square className="size-4" />
            </Button>
          </Hint>
          <Separator orientation="vertical" className="mx-2" />
          <ResourceLinks projectId={id} />
          <Separator orientation="vertical" className="mx-2" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                Export
                <Download className="size-4 ml-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuItem
                className="flex items-center gap-x-2"
                onClick={() => editor?.saveJson()}
              >
                <CiFileOn className="size-8" />
                <div>
                  <p>JSON</p>
                  <p className="text-xs text-muted-foreground">
                    Save for later editing
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-x-2"
                onClick={() => editor?.savePng()}
              >
                <CiFileOn className="size-8" />
                <div>
                  <p>PNG</p>
                  <p className="text-xs text-muted-foreground">
                    Best for sharing on the web
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-x-2"
                onClick={() => editor?.saveJpg()}
              >
                <CiFileOn className="size-8" />
                <div>
                  <p>JPG</p>
                  <p className="text-xs text-muted-foreground">
                    Best for printing
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-x-2"
                onClick={() => editor?.saveSvg()}
              >
                <CiFileOn className="size-8" />
                <div>
                  <p>SVG</p>
                  <p className="text-xs text-muted-foreground">
                    Best for editing in vector software
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <UserButton />
        </div>
      </div>
    </nav>
  );
};
