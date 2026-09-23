import { useEffect, useState } from "react";
import type { IllustrationPage } from "../../domain/learning";
import { readIllustration } from "../../transport/illustrations";

export default function IllustrationCanvas({
  courseId,
  page,
}: {
  courseId: string;
  page: IllustrationPage;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectURL = "";
    setFailed(false);
    void readIllustration(courseId, page.assetId).then(
      (blob) => {
        if (!active) return;
        objectURL = URL.createObjectURL(blob);
        setSource(objectURL);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [courseId, page.assetId]);

  return (
    <article className="illustration-page" aria-label={page.title}>
      {source ? (
        <img src={source} alt={page.alt} />
      ) : (
        <div
          className="illustration-loading"
          role={failed ? "alert" : "status"}
        >
          {failed ? "教学插图加载失败" : "正在加载教学插图…"}
        </div>
      )}
    </article>
  );
}
