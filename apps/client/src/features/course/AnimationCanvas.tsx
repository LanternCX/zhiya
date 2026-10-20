import { useEffect, useRef, useState } from "react";
import { Graph } from "@antv/x6";
import { diagramLines, layoutDiagram } from "./diagram-layout";
import type {
  AnimationAction,
  AnimationPage,
  AnimationPlaybackCommand,
  AnimationPlaybackState,
} from "../../domain/learning";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const edgeLabel = (text: string) => ({
  position: { distance: 0.75, offset: 12 },
  attrs: {
    label: { text, fill: "var(--muted)", fontSize: 13, fontFamily: "inherit" },
    body: { fill: "var(--surface)", stroke: "none", rx: 4, ry: 4 },
  },
});

export type AnimationController = {
  control: (command: AnimationPlaybackCommand) => AnimationPlaybackState;
  read: () => AnimationPlaybackState;
};

export default function AnimationCanvas({
  page,
  active,
  onController,
  onPlayback,
}: {
  page: AnimationPage;
  active: boolean;
  onController: (controller: AnimationController | null) => void;
  onPlayback?: (state:AnimationPlaybackState)=>void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const graph = useRef<Graph | null>(null);
  const edgePositions = useRef(new Map<string, { distance: number; offset: { x: number; y: number } }>());
  const labelsForEdge = (id: string, text: string) => text ? [{
    ...edgeLabel(diagramLines(text, 12).join("\n")),
    position: edgePositions.current.get(id),
  }] : [];
  const run = useRef(0);
  const paused = useRef(false);
  const commandLocked = useRef(false);
  const playback = useRef<AnimationPlaybackState>({
    pageId: page.id,
    status: "idle",
    step: 0,
  });
  const command = useRef<(value: AnimationPlaybackCommand) => AnimationPlaybackState>(
    () => playback.current,
  );
  const [playing, setPlaying] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = new Graph({
      container: element,
      width: Math.max(element.clientWidth, 1),
      height: Math.max(element.clientHeight, 1),
      background: { color: "transparent" },
      grid: false,
      interacting: false,
      panning: true,
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2.5 },
    });
    graph.current = instance;
    let cancelled = false;
    setReady(false);
    setLayoutError("");
    edgePositions.current.clear();
    void layoutDiagram(page).then(layout => {
    if (cancelled) return;
    const positions = new Map(layout.nodes.map(node => [node.id, node]));
    const groups = page.nodes.filter((node) => node.shape === "group");
    for (const node of groups) {
      const position = positions.get(node.id)!;
      instance.addNode({
        id: node.id,
        shape: "rect",
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        zIndex: 0,
        label: position.lines.join("\n"),
        attrs: {
          body: { rx: 12, ry: 12, fill: "var(--subtle)", stroke: "var(--line)", strokeDasharray: "6 5" },
          label: { fill: "var(--muted)", fontSize: 16, lineHeight: 24, refY: 24 + (position.lines.length - 1) * 12, textAnchor: "middle", fontFamily: "inherit" },
        },
      });
    }
    const contentNodes = page.nodes.filter((node) => node.shape !== "group");
    for (const node of contentNodes) {
      const position = positions.get(node.id)!;
      const shape = node.shape === "circle" ? "ellipse" : node.shape === "diamond" ? "polygon" : "rect";
      const cell = instance.addNode({
        id: node.id,
        shape,
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        zIndex: 2,
        label: position.lines.join("\n"),
        attrs: {
          body: {
            ...(shape === "polygon"
              ? { refPoints: "0,10 10,0 20,10 10,20" }
              : {}),
            fill: node.shape === "text" ? "transparent" : "var(--subtle)",
            stroke: node.shape === "text" ? "transparent" : "var(--muted)",
            strokeWidth: 1.5,
            rx: 10,
            ry: 10,
          },
          label: { fill: "var(--text)", fontSize: 16, lineHeight: 24, fontWeight: 500, fontFamily: "inherit" },
        },
      });
      if (node.groupId) instance.getCellById(node.groupId)?.addChild(cell);
    }
    for (const edge of page.edges) {
      const route = layout.edges.find(value => value.id === edge.id)!;
      if (route.label) edgePositions.current.set(edge.id, {
        distance: 0, offset: {
          x: route.label.x + route.label.width / 2 - route.points[0].x,
          y: route.label.y + route.label.height / 2 - route.points[0].y,
        },
      });
      instance.addEdge({
        id: edge.id,
        source: route.points[0],
        target: route.points.at(-1)!,
        vertices: route.points.slice(1, -1),
        zIndex: 1,
        connector: { name: "rounded", args: { radius: 12 } },
        attrs: {
          line: {
            stroke: "var(--muted)",
            strokeWidth: 1.5,
            targetMarker: edge.arrow === false ? null : { name: "block", width: 8, height: 6 },
          },
        },
        labels: labelsForEdge(edge.id, edge.label ?? ""),
      });
    }
    setReady(true);
    previousWidth = previousHeight = 0;
    resize();
    }).catch(error => {
      if (!cancelled) {
        instance.clearCells();
        setLayoutError(error instanceof Error ? error.message : "图示布局失败");
      }
    });
    const host = element.parentElement!;
    let previousWidth = 0;
    let previousHeight = 0;
    const resize = () => {
      // X6 writes inline dimensions on its container. Measure the independent
      // grid cell so an initialization while hidden cannot lock it at zero.
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) {
        previousWidth = previousHeight = 0;
        return;
      }
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      instance.resize(width, height);
      instance.zoomToFit({ padding: 32, maxScale: 1 });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      cancelled = true;
      observer.disconnect();
      run.current++;
      graph.current = null;
      instance.dispose();
    };
  }, [page]);

  const reset = () => {
    run.current++;
    paused.current = false;
    setPlaying(false);
    const instance = graph.current;
    if (!instance) {
      playback.current = { pageId: page.id, status: "idle", step: 0 };
      onPlayback?.(playback.current);
      return playback.current;
    }
    for (const node of page.nodes) {
      const cell = instance.getCellById(node.id);
      cell?.setVisible(true);
      if (cell?.isNode()) {
        cell.attr("body/stroke", node.shape === "text" ? "transparent" : node.shape === "group" ? "var(--line)" : "var(--muted)");
        cell.attr("body/strokeWidth", node.shape === "group" ? 1 : 1.5);
        cell.attr("label/text", diagramLines(node.label).join("\n"));
        if (node.shape === "group") cell.attr("label/refY", 24 + (diagramLines(node.label).length - 1) * 12);
      }
    }
    for (const edge of page.edges) {
      const cell = instance.getCellById(edge.id);
      cell?.setVisible(true);
      if (cell?.isEdge()) {
        cell.attr("line/stroke", "var(--muted)");
        cell.attr("line/strokeWidth", 1.5);
        cell.attr("line/strokeDasharray", "");
        cell.attr("line/style/animation", "");
        cell.setLabels(labelsForEdge(edge.id, edge.label ?? ""));
      }
    }
    playback.current = { pageId: page.id, status: "idle", step: 0 };
    onPlayback?.(playback.current);
    return playback.current;
  };

  const applyAction = (action: AnimationAction) => {
    const cell = graph.current?.getCellById(action.targetId);
    if (!cell) return;
    if (action.type === "show") cell.setVisible(true);
    if (action.type === "hide") cell.setVisible(false);
    if (action.type === "highlight") {
      if (cell.isNode()) {
        cell.attr("body/stroke", "var(--accent)");
        cell.attr("body/strokeWidth", 4);
      } else {
        cell.attr("line/stroke", "var(--accent)");
        cell.attr("line/strokeWidth", 4);
      }
    }
    if (action.type === "flow" && cell.isEdge()) {
      cell.attr("line/stroke", "var(--accent)");
      cell.attr("line/strokeWidth", 3);
      cell.attr("line/strokeDasharray", "8 6");
      cell.attr("line/style/animation", "animation-flow 0.7s linear infinite");
    }
    if (action.type === "update") {
      if (cell.isNode()) {
        const lines = diagramLines(action.value);
        cell.attr("label/text", lines.join("\n"));
        if (page.nodes.find(node => node.id === action.targetId)?.shape === "group")
          cell.attr("label/refY", 24 + (lines.length - 1) * 12);
      }
      else if (cell.isEdge()) cell.setLabels(labelsForEdge(action.targetId, action.value));
    }
  };

  const pause = () => {
    paused.current = true;
    run.current++;
    setPlaying(false);
    playback.current = {
      ...playback.current,
      status: playback.current.status === "idle" ? "idle" : "paused",
    };
    onPlayback?.(playback.current);
    return playback.current;
  };

  const play = (buttonId: string, steps: AnimationAction[][]) => {
    if (!ready) throw new Error(layoutError || "图示正在排版，请稍后播放");
    if (playback.current.status === "playing") return playback.current;
    const resume =
      playback.current.status === "paused" &&
      playback.current.buttonId === buttonId;
    const startStep = resume ? playback.current.step : 0;
    if (!resume) reset();
    const token = ++run.current;
    paused.current = false;
    setPlaying(true);
    playback.current = {
      pageId: page.id,
      status: "playing",
      buttonId,
      step: startStep,
    };
    onPlayback?.(playback.current);
    void (async () => {
      for (const [index, step] of steps.entries()) {
        if (index < startStep) continue;
        if (run.current !== token || paused.current) break;
        for (const action of step) applyAction(action);
        playback.current = { ...playback.current, step: index + 1 };
        onPlayback?.(playback.current);
        await wait(650);
      }
      if (run.current === token) {
        setPlaying(false);
        playback.current = { ...playback.current, status: "complete" };
        onPlayback?.(playback.current);
      }
    })();
    return playback.current;
  };

  command.current = (value) => {
    if (commandLocked.current) throw new Error("动画正在处理另一条控制指令");
    commandLocked.current = true;
    try {
      if (value.action === "pause") return pause();
      if (value.action === "reset") return reset();
      const button = page.buttons.find((candidate) => candidate.id === value.buttonId);
      if (!button) throw new Error(`找不到动画按钮 ${value.buttonId}`);
      return play(button.id, button.steps);
    } finally {
      commandLocked.current = false;
    }
  };

  useEffect(() => {
    const controller: AnimationController = {
      control: (value) => command.current(value),
      read: () => ({ ...playback.current }),
    };
    onController(controller);
    return () => onController(null);
  }, [onController]);

  useEffect(() => {
    if (!active && playback.current.status === "playing") pause();
  }, [active]);

  return (
    <article className="animation-page" aria-label={`动画页面：${page.title}`} role="img">
      <header>
        <div>
          <span>互动图示</span>
          <h2>{page.title}</h2>
        </div>
        <nav aria-label="画布视图控制">
          <button aria-label="缩小画布" onClick={() => graph.current?.zoom(-0.15)}>−</button>
          <button aria-label="适应窗口" onClick={() => graph.current?.zoomToFit({ padding: 48, maxScale: 1 })}>适应</button>
          <button aria-label="放大画布" onClick={() => graph.current?.zoom(0.15)}>＋</button>
        </nav>
      </header>
      <div className="animation-canvas-host">
        {layoutError && <p role="alert">图示暂时无法展示：{layoutError}</p>}
        <div className="animation-canvas" ref={container} />
      </div>
      {page.buttons.length > 0 && <footer>
        <div className="animation-presets">
          {page.buttons.map((button) => (
            <button
              key={button.id}
              disabled={playing || !ready}
              onClick={() => command.current({ action: "play", buttonId: button.id })}
            >
              <span aria-hidden="true">▶</span>
              {button.label}
            </button>
          ))}
        </div>
        <div className="animation-playback">
          <button
            aria-label="暂停动画"
            disabled={!playing}
            onClick={() => command.current({ action: "pause" })}
          >
            暂停
          </button>
          <button
            aria-label="重置动画"
            onClick={() => command.current({ action: "reset" })}
          >
            重置
          </button>
        </div>
      </footer>}
    </article>
  );
}
