import { useState } from "react";
import Icon from "../../components/Icon";
import CourseCover from "./CourseCover";
import type { StoredCourse } from "../../domain/learning";

export default function CourseLibrary({
  courses,
  error,
  onOpen,
  onRename,
  onDelete,
}: {
  courses: StoredCourse[];
  error: string;
  onOpen: (course: StoredCourse) => void;
  onRename: (course: StoredCourse, title: string) => Promise<boolean>;
  onDelete: (course: StoredCourse) => Promise<boolean>;
}) {
  const [menu, setMenu] = useState("");
  const [renaming, setRenaming] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  if (!courses.length && !error) return null;
  return (
    <section className="course-library" aria-label="已有课程">
      {error && <p className="course-library-error" role="status">{error}</p>}
      {courses.length > 0 && (
        <div className="course-grid">
          {courses.map((course) => (
            <article className="course-card" key={course.id}>
              <button
                type="button"
                className="course-card-open"
                aria-label={`打开课程：${course.title}`}
                onClick={() => onOpen(course)}
              >
                <CourseCover title={course.title} cover={course.cover} />
                <span className="course-card-copy">
                  <strong>{course.title}</strong>
                  <span>{course.topic}</span>
                </span>
              </button>
              <button
                type="button"
                className="course-card-menu-trigger"
                aria-label={`管理课程：${course.title}`}
                aria-expanded={menu === course.id}
                onClick={() => {
                  setMenu(menu === course.id ? "" : course.id);
                  setConfirmDelete("");
                }}
              >
                <Icon name="more" />
              </button>
              {menu === course.id && (
                <div className="course-card-menu">
                  {renaming === course.id ? (
                    <input
                      autoFocus
                      aria-label={`重命名${course.title}`}
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenaming("");
                        if (event.key === "Enter" && renameDraft.trim()) {
                          void onRename(course, renameDraft.trim()).then((ok) => {
                            if (!ok) return;
                            setRenaming("");
                            setMenu("");
                          });
                        }
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameDraft(course.title);
                          setRenaming(course.id);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="danger-text"
                        onClick={() => {
                          if (confirmDelete !== course.id) {
                            setConfirmDelete(course.id);
                            return;
                          }
                          void onDelete(course).then((ok) => {
                            if (ok) setMenu("");
                          });
                        }}
                      >
                        {confirmDelete === course.id ? "确认删除" : "删除"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
