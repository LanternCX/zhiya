const paths = {
  classroom: "M3 4h18v12H3ZM7 20h10M12 16v4M7 8h5M7 12h9",
  teacher: "M14 4h7v11h-5M17 8h2M7 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 21v-7a4 4 0 0 1 8 0v7M11 13l5-3",
  student: "m2 7 10-4 10 4-10 4L2 7ZM6 9v6c3 3 9 3 12 0V9M22 7v7",
  people: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM2 20v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 13a5 5 0 0 1 3 5v2",
  invite: "M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM2 21v-3a7 7 0 0 1 11-5M18 13v8M14 17h8",
  copy: "M8 8h13v13H8ZM16 8V3H3v13h5",
  plus: "M12 4v16M4 12h16",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  learning:
    "M4 19V5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1ZM12 6v14",
  notebook: "M7 3h10v18H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 8h5M8 12h5M8 16h3",
  profile: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a8 8 0 0 1 16 0v2",
  shield: "m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Zm-4 10 3 3 5-6",
  logout: "M10 3H4v18h6M9 12h12m-4-4 4 4-4 4",
  sidebar: "M3 4h18v16H3ZM9 4v16M5 8h2M5 12h2",
  close: "m6 6 12 12M6 18 18 6",
  send: "M12 20V4m-7 7 7-7 7 7",
  check: "m5 12 4 4L19 6",
  back: "M20 12H4m6-6-6 6 6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
export type IconName = keyof typeof paths;
export default function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
