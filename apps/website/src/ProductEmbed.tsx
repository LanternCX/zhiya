import { useEffect, useRef, useState } from 'react';
import { classroomScenes } from './demo-content';
import { forwardEmbedWheel } from './embed-wheel';
import { connectEmbedScroll } from './embed-scroll';

export default function ProductEmbed({ label, initialScene = 'materials', teacher = false, classroom = false }: { label: string; initialScene?: string; teacher?: boolean; classroom?: boolean }) {
  const [scene, setScene] = useState(initialScene);
  const [role, setRole] = useState(teacher ? 'teacher' : 'student');
  const [reset, setReset] = useState(0);
  const releaseWheel = useRef<(() => void) | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => () => releaseWheel.current?.(), []);
  const source = import.meta.env.BASE_URL + 'product-demo/index.html?scene=' + scene + '&role=' + role;
  return <section className="product-demo original-product-demo" aria-label={label}>
    {classroom && <div className="demo-scenarios">{classroomScenes.map(item => <button key={item.id} aria-pressed={scene === item.id} onClick={() => setScene(item.id)}>{item.name}</button>)}</div>}
    <div className="product-scroll-stage" ref={stage}><div className="product-scroll-panel" ref={panel}>
    <div className="product-embed-toolbar"><span>知芽 · 原版产品界面 / 预设演示</span><div>{!classroom && <button onClick={() => setRole(role === 'student' ? 'teacher' : 'student')}>{role === 'student' ? '切换教师身份' : '切换学生身份'}</button>}<button onClick={() => setReset(reset + 1)}>重置演示</button><a href={source} target="_blank" rel="noreferrer">展开体验 ↗</a></div></div>
    <iframe key={scene + role + reset} title={label + '：知芽原版界面'} src={source} loading="lazy" onLoad={event => {
      releaseWheel.current?.();
      const releaseInput = forwardEmbedWheel(event.currentTarget);
      const releaseScroll = stage.current && panel.current ? connectEmbedScroll(stage.current, panel.current, event.currentTarget) : () => {};
      releaseWheel.current = () => { releaseInput(); releaseScroll(); };
    }} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" />
    <div className="product-scroll-caption"><span className="product-scroll-hint">继续滚动，展开这一段</span><div className="product-scroll-progress" aria-hidden="true"><i /></div><a href={source} target="_blank" rel="noreferrer">自由操作 ↗</a></div>
    </div></div>
    <p className="demo-disclosure">界面直接复用桌面客户端；回复、材料和运行结果为浏览器内预设。可以操作原版侧栏、课堂、文档、班级与分享。语音只展示预设内容，不采集麦克风。</p>
  </section>;
}
