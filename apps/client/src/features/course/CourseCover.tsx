import type { CourseCover as CourseCoverData } from "../../domain/learning";

function Motif({ motif }: { motif: CourseCoverData["motif"] }) {
  if (motif === "code")
    return (
      <g className="cover-motif cover-code">
        <path d="M76 77 252 48l31 188-176 29z" />
        <path d="m118 129 27 18-20 27m91-61-25 83" />
        <circle cx="112" cy="105" r="5" />
        <circle cx="130" cy="102" r="5" />
        <path d="m155 222 81-14" />
      </g>
    );
  if (motif === "orbit")
    return (
      <g className="cover-motif cover-orbit">
        <ellipse cx="178" cy="154" rx="113" ry="54" transform="rotate(-24 178 154)" />
        <ellipse cx="178" cy="154" rx="74" ry="115" transform="rotate(38 178 154)" />
        <circle className="cover-solid" cx="174" cy="154" r="31" />
        <circle className="cover-dot" cx="81" cy="196" r="12" />
        <circle className="cover-dot" cx="246" cy="80" r="8" />
      </g>
    );
  if (motif === "geometry")
    return (
      <g className="cover-motif cover-geometry">
        <path className="cover-solid" d="m57 229 90-170 57 206z" />
        <circle cx="219" cy="137" r="70" />
        <path d="M54 188h225M91 92l161 112" />
        <circle className="cover-dot" cx="219" cy="137" r="11" />
      </g>
    );
  if (motif === "language")
    return (
      <g className="cover-motif cover-language">
        <path className="cover-solid" d="M52 75h182v105H109l-45 36 13-36H52z" />
        <path d="M103 111h89M103 137h61M135 214h132M166 239h70" />
        <circle className="cover-dot" cx="265" cy="68" r="18" />
      </g>
    );
  if (motif === "nature")
    return (
      <g className="cover-motif cover-nature">
        <path d="M166 270c-5-79 15-142 72-201M176 205c-63-4-101-33-108-87 60-5 101 23 108 87Zm18-54c4-57 35-91 91-96 2 56-29 91-91 96Z" />
        <circle className="cover-dot" cx="86" cy="75" r="9" />
        <circle className="cover-dot" cx="264" cy="214" r="15" />
      </g>
    );
  if (motif === "history")
    return (
      <g className="cover-motif cover-history">
        <path className="cover-solid" d="M64 241V111l104-58 104 58v130h-38V127l-66-37-66 37v114z" />
        <path d="M42 241h253M124 145h88M124 177h88M124 209h54" />
        <circle className="cover-dot" cx="274" cy="74" r="17" />
      </g>
    );
  return (
    <g className="cover-motif cover-abstract">
      <path className="cover-solid" d="M36 196c57-112 112-151 174-116 39 22 38 75 90 93-65 98-219 118-264 23Z" />
      <path d="M35 92c72 9 113 63 151 177M82 55c35 70 105 104 213 100" />
      <circle className="cover-dot" cx="249" cy="75" r="18" />
    </g>
  );
}

export default function CourseCover({
  title,
  cover,
}: {
  title: string;
  cover: CourseCoverData;
}) {
  return (
    <figure className={`course-cover palette-${cover.palette}`}>
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label={`课程封面：${title}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <rect className="cover-paper" width="320" height="320" />
        <path className="cover-ruling" d="M22 29h276M22 291h276" />
        <Motif motif={cover.motif} />
      </svg>
      <figcaption>{cover.label}</figcaption>
    </figure>
  );
}
