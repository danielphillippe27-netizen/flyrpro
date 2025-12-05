"use client";

import { fabric } from "fabric";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useRef, useState } from "react";

import { ResponseType } from "@/lib/editor-canva/features/projects/api/use-get-project";
import { useUpdateProject } from "@/lib/editor-canva/features/projects/api/use-update-project";

import { 
  ActiveTool, 
  selectionDependentTools
} from "@/lib/editor-canva/features/editor/types";
import { Navbar } from "@/lib/editor-canva/features/editor/components/navbar";
import { Footer } from "@/lib/editor-canva/features/editor/components/footer";
import { useEditor } from "@/lib/editor-canva/features/editor/hooks/use-editor";
import { Sidebar } from "@/lib/editor-canva/features/editor/components/sidebar";
import { Toolbar } from "@/lib/editor-canva/features/editor/components/toolbar";
import { ShapeSidebar } from "@/lib/editor-canva/features/editor/components/shape-sidebar";
import { FillColorSidebar } from "@/lib/editor-canva/features/editor/components/fill-color-sidebar";
import { StrokeColorSidebar } from "@/lib/editor-canva/features/editor/components/stroke-color-sidebar";
import { StrokeWidthSidebar } from "@/lib/editor-canva/features/editor/components/stroke-width-sidebar";
import { OpacitySidebar } from "@/lib/editor-canva/features/editor/components/opacity-sidebar";
import { TextSidebar } from "@/lib/editor-canva/features/editor/components/text-sidebar";
import { FontSidebar } from "@/lib/editor-canva/features/editor/components/font-sidebar";
import { ImageSidebar } from "@/lib/editor-canva/features/editor/components/image-sidebar";
import { FilterSidebar } from "@/lib/editor-canva/features/editor/components/filter-sidebar";
import { TemplateSidebar } from "@/lib/editor-canva/features/editor/components/template-sidebar";
import { RemoveBgSidebar } from "@/lib/editor-canva/features/editor/components/remove-bg-sidebar";
import { LayersSidebar } from "@/lib/editor-canva/features/editor/components/layers-sidebar";
import { SettingsSidebar } from "@/lib/editor-canva/features/editor/components/settings-sidebar";
import { UploadsSidebar } from "@/lib/editor-canva/features/editor/components/uploads-sidebar";
import { BackgroundSidebar } from "@/lib/editor-canva/features/editor/components/background-sidebar";
import { IconsSidebar } from "@/lib/editor-canva/features/editor/components/icons-sidebar";
import { QRSidebar } from "@/lib/editor-canva/features/editor/components/qr-sidebar";

interface EditorProps {
  initialData: ResponseType["data"];
};

export const Editor = ({ initialData }: EditorProps) => {
  const { mutate } = useUpdateProject(initialData.id);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(
      (values: { 
        json: string,
        height: number,
        width: number,
      }) => {
        mutate(values);
    },
    500
  ), [mutate]);

  const [activeTool, setActiveTool] = useState<ActiveTool>("select");

  const onClearSelection = useCallback(() => {
    if (selectionDependentTools.includes(activeTool)) {
      setActiveTool("select");
    }
  }, [activeTool]);

  const { init, editor } = useEditor({
    defaultState: initialData.json,
    defaultWidth: initialData.width,
    defaultHeight: initialData.height,
    clearSelectionCallback: onClearSelection,
    saveCallback: debouncedSave,
  });

  const onChangeActiveTool = useCallback((tool: ActiveTool) => {
    if (tool === activeTool) {
      return setActiveTool("select");
    }
    
    setActiveTool(tool);
  }, [activeTool]);

  const canvasRef = useRef(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = new fabric.Canvas(canvasRef.current, {
      controlsAboveOverlay: true,
      preserveObjectStacking: true,
    });

    init({
      initialCanvas: canvas,
      initialContainer: containerRef.current!,
    });

    return () => {
      canvas.dispose();
    };
  }, [init]);

  return (
    <div className="h-full flex flex-col">
      <Navbar
        id={initialData.id}
        editor={editor}
        activeTool={activeTool}
        onChangeActiveTool={onChangeActiveTool}
        projectName={initialData.name}
      />
      <div className="absolute h-[calc(100%-68px)] w-full top-[68px] flex">
        <Sidebar
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <ShapeSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <FillColorSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <StrokeColorSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <StrokeWidthSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <OpacitySidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <TextSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <FontSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <ImageSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <TemplateSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <FilterSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <RemoveBgSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <LayersSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <SettingsSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <UploadsSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <BackgroundSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <IconsSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <QRSidebar
          editor={editor}
          activeTool={activeTool}
          onChangeActiveTool={onChangeActiveTool}
        />
        <main className="bg-slate-800 flex-1 overflow-auto relative flex flex-col">
          <Toolbar
            editor={editor}
            activeTool={activeTool}
            onChangeActiveTool={onChangeActiveTool}
            key={JSON.stringify(editor?.canvas.getActiveObject())}
          />
          <div className="flex-1 h-[calc(100%-124px)] bg-slate-800 relative flex items-center justify-center p-8" ref={containerRef}>
            <div className="bg-white shadow-xl rounded-sm inline-block">
              <canvas ref={canvasRef} className="block" />
            </div>
          </div>
          <Footer editor={editor} />
        </main>
      </div>
    </div>
  );
};
