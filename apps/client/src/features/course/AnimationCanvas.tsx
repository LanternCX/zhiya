import { useEffect, useRef, useState } from "react";
import { Graph } from "@antv/x6";
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

function flowPositions(page: AnimationPage) {
  if (page.nodes.some(node => node.shape === "group")) return new Map<string, { x: number; y: number }>();
  const nodes = page.nodes.filter(node => node.shape !== "group" && !node.groupId);
  const ranks = new Map<string, number>();
  const remaining = new Set(nodes.map(node => node.id));
  const edges = page.edges.filter(edge => remaining.has(edge.source) && remaining.has(edge.target));
  // Longest-path layers keep both branches beside each other and joins after
  // their predecessors. Cyclic diagrams retain the explicit layout order.
  while (remaining.size) {
    const ready = [...remaining].filter(id => !edges.some(edge => edge.target === id && remaining.has(edge.source)));
    if (!ready.length) return new Map<string, { x: number; y: number }>();
    for (const id of ready) {
      ranks.set(id, Math.max(0, ...edges.filter(edge => edge.target === id).map(edge => (ranks.get(edge.source) ?? 0) + 1)));
      remaining.delete(id);
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  if (page.layout === "grid" || !edges.length) return positions;
  for (const node of nodes) {
    const rank = ranks.get(node.id)!;
    const peers = nodes.filter(candidate => ranks.get(candidate.id) === rank);
    const cross = (peers.indexOf(node) - (peers.length - 1) / 2) * 260;
    positions.set(node.id, page.layout === "vertical"
      ? { x: cross, y: rank * 180 }
      : { x: rank * 280, y: cross });
  }
  return positions;
}

function nodePosition(
  index: number,
  count: number,
  layout: AnimationPage["layout"],
) {
  if (layout === "vertical") return { x: 310, y: 70 + index * 130 };
  if (layout === "grid") {
    const columns = Math.min(3, Math.ceil(Math.sqrt(count)));
    return { x: 90 + (index % columns) * 230, y: 70 + Math.floor(index / columns) * 150 };
  }
  return { x: 70 + index * 235, y: 190 };
}

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
    const positions = flowPositions(page);

    const groups = page.nodes.filter((node) => node.shape === "group");
    const groupPositions = new Map<string, { x: number; y: number }>();
    for (const [index, node] of groups.entries()) {
      const position = nodePosition(index, Math.max(groups.length, 1), page.layout);
      groupPositions.set(node.id, position);
      instance.addNode({
        id: node.id,
        shape: "rect",
        x: position.x - 28,
        y: position.y - 34,
        width: 210,
        height: 130,
        zIndex: 0,
        label: node.label,
        attrs: {
          body: { rx: 12, ry: 12, fill: "var(--subtle)", stroke: "var(--line)", strokeDasharray: "6 5" },
          label: { fill: "var(--muted)", fontSize: 13, refY: 16, textAnchor: "middle", fontFamily: "inherit" },
        },
      });
    }
    const contentNodes = page.nodes.filter((node) => node.shape !== "group");
    const groupChildren = new Map<string, number>();
    for (const [index, node] of contentNodes.entries()) {
      const groupPosition = node.groupId
        ? groupPositions.get(node.groupId)
        : undefined;
      const childIndex = node.groupId
        ? (groupChildren.get(node.groupId) ?? 0)
        : 0;
      if (node.groupId) groupChildren.set(node.groupId, childIndex + 1);
      const position = groupPosition
        ? {
            x: groupPosition.x - 12 + (childIndex % 2) * 92,
            y: groupPosition.y + 6 + Math.floor(childIndex / 2) * 52,
          }
        : positions.get(node.id) ?? nodePosition(index, contentNodes.length, page.layout);
      const shape = node.shape === "circle" ? "ellipse" : node.shape === "diamond" ? "polygon" : "rect";
      const cell = instance.addNode({
        id: node.id,
        shape,
        x: position.x,
        y: position.y,
        width: groupPosition ? 82 : 190,
        height: groupPosition ? 42 : node.shape === "diamond" ? 120 : 82,
        zIndex: 2,
        label: node.label,
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
          label: { fill: "var(--text)", fontSize: 16, fontWeight: 500, fontFamily: "inherit", textWrap: { width: node.shape === "diamond" ? "55%" : -24, height: node.shape === "diamond" ? "50%" : -16, ellipsis: true } },
        },
      });
      if (node.groupId) instance.getCellById(node.groupId)?.addChild(cell);
    }
    for (const edge of page.edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      const forward = from && to && (page.layout === "vertical" ? to.y > from.y : to.x > from.x);
      const sourceSide = page.layout === "vertical" ? "bottom" : "right";
      const targetSide = page.layout === "vertical" ? "top" : "left";
      instance.addEdge({
        id: edge.id,
        source: forward ? { cell: edge.source, anchor: { name: sourceSide } } : edge.source,
        target: forward ? { cell: edge.target, anchor: { name: targetSide } } : edge.target,
        zIndex: 1,
        router: { name: "manhattan", args: { padding: 18, ...(forward ? { startDirections: [sourceSide], endDirections: [targetSide] } : {}) } },
        connector: { name: "rounded", args: { radius: 12 } },
        attrs: {
          line: {
            stroke: "var(--muted)",
            strokeWidth: 1.5,
            targetMarker: edge.arrow === false ? null : { name: "block", width: 8, height: 6 },
          },
        },
        labels: edge.label
          ? [edgeLabel(edge.label)]
          : [],
      });
    }
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
        cell.attr("label/text", node.label);
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
        cell.setLabels(edge.label ? [edgeLabel(edge.label)] : []);
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
      if (cell.isNode()) cell.attr("label/text", action.value);
      else if (cell.isEdge()) cell.setLabels([edgeLabel(action.value)]);
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
        <div className="animation-canvas" ref={container} />
      </div>
      <footer>
        <div className="animation-presets">
          {page.buttons.map((button) => (
            <button
              key={button.id}
              disabled={playing}
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
      </footer>
    </article>
  );
}
