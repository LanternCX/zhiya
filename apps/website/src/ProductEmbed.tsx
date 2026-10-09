import { useEffect, useRef, useState } from 'react';
import { classroomScenes } from './demo-content';
import { forwardEmbedWheel } from './embed-wheel';
import { connectEmbedScroll } from './embed-scroll';
import { revealPreview } from './preview-motion';

export default function ProductEmbed({ label, initialScene = 'materials', teacher = false, classroom = false }: { label: string; initialScene?: string; teacher?: boolean; classroom?: boolean }) {
  const [scene, setScene] = useState(initialScene);
  const [role, setRole] = useState(teacher ? 'teacher' : 'student');
  const [reset, setReset] = useState(0);
  const [loading, setLoading] = useState(true);
  const releaseWheel = useRef<(() => void) | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => () => releaseWheel.current?.(), []);
  const source = import.meta.env.BASE_URL + 'product-demo/index.html?scene=' + scene + '&role=' + role;
  return <section className="product-demo original-product-demo" aria-label={label}>
    {classroom && <div className="demo-scenarios">{classroomScenes.map(item => <button key={item.id} aria-pressed={scene === item.id} onClick={() => { if (scene !== item.id) { setLoading(true); setScene(item.id); } }}>{item.name}</button>)}</div>}
    <div className="product-scroll-stage" ref={stage}><div className="product-scroll-panel" ref={panel}>
    <div className="product-embed-toolbar"><span>知芽 · 原版产品界面 / 预设演示</span><div>{!classroom && <button onClick={() => { setLoading(true); setRole(role === 'student' ? 'teacher' : 'student'); }}>{role === 'student' ? '切换教师身份' : '切换学生身份'}</button>}<button onClick={() => { setLoading(true); setReset(reset + 1); }}>重置演示</button><a href={source} target="_blank" rel="noreferrer">展开体验 ↗</a></div></div>
    <div className="product-embed-viewport" aria-busy={loading}>
    <iframe key={scene + role + reset} title={label + '：知芽原版界面'} src={source} loading="lazy" onLoad={event => {
      releaseWheel.current?.();
      const releaseInput = forwardEmbedWheel(event.currentTarget);
      const releaseScroll = stage.current && panel.current ? connectEmbedScroll(stage.current, panel.current, event.currentTarget) : () => {};
      releaseWheel.current = () => { releaseInput(); releaseScroll(); };
      setLoading(false);
      revealPreview(event.currentTarget);
    }} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" />
    {loading && <div className="product-embed-loading" role="status"><span aria-hidden="true">✳</span>正在载入演示…</div>}
    </div>
    <div className="product-scroll-caption"><span className="product-scroll-hint">继续滚动，展开这一段</span><div className="product-scroll-progress" aria-hidden="true"><i /></div><a href={source} target="_blank" rel="noreferrer">自由操作 ↗</a></div>
    </div></div>
    <p className="demo-disclosure">这是知芽的实际界面，演示内容已提前准备好。可以点击操作，也可以展开体验。语音演示不会开启麦克风。</p>
  </section>;
}
