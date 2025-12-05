"use client";

import { 
  LayoutTemplate,
  ImageIcon,
  Settings,
  Shapes,
  Type,
  Layers,
  Upload,
  Palette,
  Sparkles,
  QrCode,
} from "lucide-react";

import { ActiveTool } from "@/lib/editor-canva/features/editor/types";
import { SidebarItem } from "@/lib/editor-canva/features/editor/components/sidebar-item";

interface SidebarProps {
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const Sidebar = ({
  activeTool,
  onChangeActiveTool,
}: SidebarProps) => {
  return (
    <aside className="bg-white flex flex-col w-[100px] h-full border-r overflow-y-auto">
      <ul className="flex flex-col">
        <SidebarItem
          icon={LayoutTemplate}
          label="Design"
          isActive={activeTool === "templates"}
          onClick={() => onChangeActiveTool("templates")}
        />
        <SidebarItem
          icon={ImageIcon}
          label="Image"
          isActive={activeTool === "images"}
          onClick={() => onChangeActiveTool("images")}
        />
        <SidebarItem
          icon={Upload}
          label="Uploads"
          isActive={activeTool === "uploads"}
          onClick={() => onChangeActiveTool("uploads")}
        />
        <SidebarItem
          icon={Type}
          label="Text"
          isActive={activeTool === "text"}
          onClick={() => onChangeActiveTool("text")}
        />
        <SidebarItem
          icon={Shapes}
          label="Shapes"
          isActive={activeTool === "shapes"}
          onClick={() => onChangeActiveTool("shapes")}
        />
        <SidebarItem
          icon={Palette}
          label="Background"
          isActive={activeTool === "background"}
          onClick={() => onChangeActiveTool("background")}
        />
        <SidebarItem
          icon={Sparkles}
          label="Icons"
          isActive={activeTool === "icons"}
          onClick={() => onChangeActiveTool("icons")}
        />
        <SidebarItem
          icon={QrCode}
          label="QR"
          isActive={activeTool === "qr"}
          onClick={() => onChangeActiveTool("qr")}
        />
        <SidebarItem
          icon={Layers}
          label="Layers"
          isActive={activeTool === "layers"}
          onClick={() => onChangeActiveTool("layers")}
        />
        <SidebarItem
          icon={Settings}
          label="Settings"
          isActive={activeTool === "settings"}
          onClick={() => onChangeActiveTool("settings")}
        />
      </ul>
    </aside>
  );
};
