import type { Slide } from "../../domain/learning";

function lines(text: string, limit: number) {
  const result: string[] = [];
  let line = "";
  for (const character of text) {
    line += character;
    if (line.length >= limit || /[。！？；]/.test(character)) {
      result.push(line);
      line = "";
    }
  }
  if (line) result.push(line);
  return result;
}

function TextLines({
  text,
  x,
  y,
  width,
  lineHeight,
  className,
  textAnchor,
}: {
  text: string;
  x: number;
  y: number;
  width: number;
  lineHeight: number;
  className: string;
  textAnchor?: "start" | "middle";
}) {
  return (
    <text x={x} y={y} className={className} textAnchor={textAnchor}>
      {lines(text, width).map((line, index) => (
        <tspan key={`${line}-${index}`} x={x} dy={index ? lineHeight : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function SlideFrame() {
  return (
    <>
      <rect className="slide-svg-background" width="1200" height="675" />
      <path className="slide-svg-rule" d="M80 72 H1120" />
      <circle className="slide-svg-index" cx="1090" cy="104" r="22" />
      <text
        className="slide-svg-index-text"
        x="1090"
        y="110"
        textAnchor="middle"
      >
        Z
      </text>
    </>
  );
}

function SpotlightLayout({ slide }: { slide: Slide }) {
  const titleLines = lines(slide.title, 14);
  return (
    <g role="group" aria-label="重点聚焦模板">
      <circle className="slide-svg-orbit" cx="600" cy="345" r="238" />
      <circle className="slide-svg-orbit-dot" cx="370" cy="200" r="15" />
      {slide.kicker && (
        <text
          className="slide-svg-kicker"
          x="600"
          y="154"
          textAnchor="middle"
        >
          {slide.kicker}
        </text>
      )}
      <text
        className="slide-svg-title spotlight-title"
        x="600"
        y="245"
        textAnchor="middle"
      >
        {titleLines.map((line, index) => (
          <tspan key={`${line}-${index}`} x="600" dy={index ? 66 : 0}>
            {line}
          </tspan>
        ))}
      </text>
      <TextLines
        text={slide.body}
        x={600}
        y={355 + Math.max(0, titleLines.length - 1) * 52}
        width={30}
        lineHeight={36}
        className="slide-svg-body spotlight-body"
        textAnchor="middle"
      />
      {slide.bullets.slice(0, 4).map((bullet, index, items) => {
        const width = 190;
        const gap = 20;
        const start =
          600 - (items.length * width + (items.length - 1) * gap) / 2;
        const x = start + index * (width + gap);
        return (
          <g key={`${bullet}-${index}`} className="slide-svg-chip">
            <rect x={x} y="500" width={width} height="58" rx="29" />
            <text x={x + width / 2} y="537" textAnchor="middle">
              {bullet}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function CardsLayout({ slide }: { slide: Slide }) {
  return (
    <g role="group" aria-label="卡片网格模板">
      {slide.kicker && (
        <text className="slide-svg-kicker" x="84" y="112">
          {slide.kicker}
        </text>
      )}
      <text className="slide-svg-title cards-title" x="82" y="178">
        {slide.title}
      </text>
      <TextLines
        text={slide.body}
        x={84}
        y={230}
        width={45}
        lineHeight={34}
        className="slide-svg-body"
      />
      {slide.bullets.slice(0, 6).map((bullet, index) => {
        const x = 82 + (index % 3) * 352;
        const y = 318 + Math.floor(index / 3) * 142;
        return (
          <g key={`${bullet}-${index}`} className="slide-svg-card">
            <rect x={x} y={y} width="316" height="112" rx="18" />
            <text className="slide-svg-number" x={x + 24} y={y + 35}>
              {String(index + 1).padStart(2, "0")}
            </text>
            <TextLines
              text={bullet}
              x={x + 24}
              y={y + 76}
              width={16}
              lineHeight={26}
              className="slide-svg-card-text"
            />
          </g>
        );
      })}
    </g>
  );
}

function TimelineLayout({ slide }: { slide: Slide }) {
  const items = slide.bullets.slice(0, 6);
  const gap = items.length > 1 ? 960 / (items.length - 1) : 0;
  return (
    <g role="group" aria-label="时间线模板">
      {slide.kicker && (
        <text className="slide-svg-kicker" x="84" y="112">
          {slide.kicker}
        </text>
      )}
      <text className="slide-svg-title timeline-title" x="82" y="180">
        {slide.title}
      </text>
      <TextLines
        text={slide.body}
        x={84}
        y={240}
        width={44}
        lineHeight={34}
        className="slide-svg-body"
      />
      {items.length > 1 && (
        <path className="slide-svg-timeline-rule" d="M120 414 H1080" />
      )}
      {items.map((bullet, index) => {
        const x = items.length === 1 ? 600 : 120 + index * gap;
        return (
          <g key={`${bullet}-${index}`} className="slide-svg-timeline-item">
            <circle cx={x} cy="414" r="24" />
            <text x={x} y="421" textAnchor="middle">
              {index + 1}
            </text>
            <TextLines
              text={bullet}
              x={x}
              y={484}
              width={9}
              lineHeight={28}
              className="slide-svg-timeline-text"
              textAnchor="middle"
            />
          </g>
        );
      })}
    </g>
  );
}

export default function SlideCanvas({ slide }: { slide: Slide }) {
  const titleLines = lines(slide.title, 12);
  const contentY = 250 + Math.max(0, titleLines.length - 1) * 66;
  const listX = slide.layout === "steps" ? 650 : 700;
  return (
    <svg
      className={`lesson-slide layout-${slide.layout}`}
      viewBox="0 0 1200 675"
      role="img"
      aria-label={`课件页面：${slide.title}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <SlideFrame />
      {slide.layout === "spotlight" ? (
        <SpotlightLayout slide={slide} />
      ) : slide.layout === "cards" ? (
        <CardsLayout slide={slide} />
      ) : slide.layout === "timeline" ? (
        <TimelineLayout slide={slide} />
      ) : (
        <g>
          {slide.kicker && (
            <text className="slide-svg-kicker" x="84" y="112">
              {slide.kicker}
            </text>
          )}
          <text className="slide-svg-title" x="82" y="184">
            {titleLines.map((line, index) => (
              <tspan key={`${line}-${index}`} x="82" dy={index ? 66 : 0}>
                {line}
              </tspan>
            ))}
          </text>
          <TextLines
            text={slide.body}
            x={84}
            y={contentY}
            width={slide.layout === "explain" ? 24 : 20}
            lineHeight={38}
            className="slide-svg-body"
          />
          {slide.bullets.map((bullet, index) => {
            const y = 190 + index * 92;
            return (
              <g key={`${bullet}-${index}`} className="slide-svg-point">
                <text className="slide-svg-number" x={listX} y={y}>
                  {String(index + 1).padStart(2, "0")}
                </text>
                <path d={`M${listX + 48} ${y - 9} H${listX + 78}`} />
                <TextLines
                  text={bullet}
                  x={listX + 92}
                  y={y}
                  width={16}
                  lineHeight={30}
                  className="slide-svg-point-text"
                />
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
