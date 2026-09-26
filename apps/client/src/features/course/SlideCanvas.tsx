import type { Slide } from "../../domain/learning";

export default function SlideCanvas({ slide }: { slide: Slide }) {
  return (
    <div
      className="lesson-slide"
      role="img"
      aria-label={`课件页面：${slide.title}`}
    >
      {slide.kicker && <p>{slide.kicker}</p>}
      <h2>{slide.title}</h2>
      <p>{slide.body}</p>
      {slide.bullets.length > 0 && (
        <ul>
          {slide.bullets.map((bullet, index) => (
            <li key={`${bullet}-${index}`}>{bullet}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
