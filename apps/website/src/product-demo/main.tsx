import { installDemoBackend } from './backend';
import { revealPreview } from '../preview-motion';
import { createRoot } from 'react-dom/client';
import { createHashRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import App from '../../../client/src/App';
import SharedDeliverable from '../../../client/src/features/deliverables/SharedDeliverable';
import { pageRoutes } from '../../../client/src/routes';
import { TooltipProvider } from '../../../client/src/components/ui/tooltip';
import { VideoPreviewContext } from '../../../client/src/features/course/VideoCanvas';
import '../../../client/src/styles.css';
import './utilities.css';
import '../../../client/src/motion.css';

const parameters = new URLSearchParams(location.search);
const scene = parameters.get('scene') ?? 'materials';
installDemoBackend(scene, parameters.get('role') === 'teacher');
document.addEventListener('load', event => {
  if (event.target instanceof HTMLIFrameElement && event.target.classList.contains('lesson-slide')) revealPreview(event.target);
}, true);
if (!location.hash) location.hash = scene === 'profile' ? '/learning-profile' : scene === 'classes' ? '/classes/demo-class' : '/courses/demo-course/conversations/demo-conversation';
const router = createHashRouter([{ path: '/shares/:token', Component: SharedDeliverable }, { path: '/', Component: App, children: pageRoutes }]);
createRoot(document.getElementById('root')!).render(
  <TooltipProvider><VideoPreviewContext.Provider value={import.meta.env.BASE_URL + 'demo-video.html'}><RouterProvider router={router} /></VideoPreviewContext.Provider></TooltipProvider>,
);
