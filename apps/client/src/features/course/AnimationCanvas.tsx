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
}: {
  page: AnimationPage;
  active: boolean;
  onController: (controller: AnimationController | null) => void;
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
      grid: { visible: true, size: 16, type: "dot", args: { color: "#a8b39f", thickness: 1 } },
      interacting: false,
      panning: true,
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2.5 },
    });
    graph.current = instance;

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
          body: { rx: 18, ry: 18, fill: "#eef2df", stroke: "#879775", strokeDasharray: "6 5" },
          label: { fill: "#59664f", fontSize: 13, refY: 16, textAnchor: "middle" },
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
        : nodePosition(index, contentNodes.length, page.layout);
      const shape = node.shape === "circle" ? "ellipse" : node.shape === "diamond" ? "polygon" : "rect";
      const cell = instance.addNode({
        id: node.id,
        shape,
        x: position.x,
        y: position.y,
        width: groupPosition ? 82 : node.shape === "text" ? 170 : 142,
        height: groupPosition ? 42 : node.shape === "text" ? 48 : 82,
        zIndex: 2,
        label: node.label,
        attrs: {
          body: {
            ...(shape === "polygon"
              ? { refPoints: "0,10 10,0 20,10 10,20" }
              : {}),
            fill: node.shape === "text" ? "transparent" : "#fffdf2",
            stroke: node.shape === "text" ? "transparent" : "#334534",
            strokeWidth: 2,
            rx: 14,
            ry: 14,
          },
          label: { fill: "#243429", fontSize: 16, fontWeight: 650, textWrap: { width: -20, height: -16, ellipsis: true } },
        },
      });
      if (node.groupId) instance.getCellById(node.groupId)?.addChild(cell);
    }
    for (const edge of page.edges) {
      instance.addEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        zIndex: 1,
        router: { name: "manhattan", args: { padding: 18 } },
        connector: { name: "rounded", args: { radius: 12 } },
        attrs: {
          line: {
            stroke: "#687767",
            strokeWidth: 2,
            ...(edge.arrow === false ? {} : { targetMarker: { name: "block", width: 9, height: 7 } }),
          },
        },
        labels: edge.label
          ? [{ attrs: { label: { text: edge.label, fill: "#4f5d4d", fontSize: 12 }, body: { fill: "#f8fae4", stroke: "#d5ddc5", rx: 5, ry: 5 } } }]
          : [],
      });
    }
    instance.centerContent();
    instance.zoomToFit({ padding: 48, maxScale: 1 });
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      instance.resize(element.clientWidth, element.clientHeight);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
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
      return playback.current;
    }
    for (const node of page.nodes) {
      const cell = instance.getCellById(node.id);
      cell?.setVisible(true);
      if (cell?.isNode()) {
        cell.attr("body/stroke", node.shape === "text" ? "transparent" : "#334534");
        cell.attr("body/strokeWidth", 2);
        cell.attr("label/text", node.label);
      }
    }
    for (const edge of page.edges) {
      const cell = instance.getCellById(edge.id);
      cell?.setVisible(true);
      if (cell?.isEdge()) {
        cell.attr("line/stroke", "#687767");
        cell.attr("line/strokeWidth", 2);
        cell.attr("line/strokeDasharray", "");
        cell.attr("line/style/animation", "");
        if (edge.label) cell.setLabels([edge.label]);
      }
    }
    playback.current = { pageId: page.id, status: "idle", step: 0 };
    return playback.current;
  };

  const applyAction = (action: AnimationAction) => {
    const cell = graph.current?.getCellById(action.targetId);
    if (!cell) return;
    if (action.type === "show") cell.setVisible(true);
    if (action.type === "hide") cell.setVisible(false);
    if (action.type === "highlight") {
      if (cell.isNode()) {
        cell.attr("body/stroke", "#e8872f");
        cell.attr("body/strokeWidth", 4);
      } else {
        cell.attr("line/stroke", "#e8872f");
        cell.attr("line/strokeWidth", 4);
      }
    }
    if (action.type === "flow" && cell.isEdge()) {
      cell.attr("line/stroke", "#2f8057");
      cell.attr("line/strokeWidth", 3);
      cell.attr("line/strokeDasharray", "8 6");
      cell.attr("line/style/animation", "animation-flow 0.7s linear infinite");
    }
    if (action.type === "update") {
      if (cell.isNode()) cell.attr("label/text", action.value);
      else if (cell.isEdge()) cell.setLabels([action.value]);
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
    void (async () => {
      for (const [index, step] of steps.entries()) {
        if (index < startStep) continue;
        if (run.current !== token || paused.current) break;
        for (const action of step) applyAction(action);
        playback.current = { ...playback.current, step: index + 1 };
        await wait(650);
      }
      if (run.current === token) {
        setPlaying(false);
        playback.current = { ...playback.current, status: "complete" };
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
          <span>INTERACTIVE DIAGRAM</span>
          <h2>{page.title}</h2>
        </div>
        <nav aria-label="画布视图控制">
          <button aria-label="缩小画布" onClick={() => graph.current?.zoom(-0.15)}>−</button>
          <button aria-label="适应窗口" onClick={() => graph.current?.zoomToFit({ padding: 48, maxScale: 1 })}>适应</button>
          <button aria-label="放大画布" onClick={() => graph.current?.zoom(0.15)}>＋</button>
        </nav>
      </header>
      <div className="animation-canvas" ref={container} />
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
