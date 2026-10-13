import http from 'node:http';
import {readFile} from 'node:fs/promises';

const fixture = new URL('../src/demo/lesson.json', import.meta.url);
const story = new URL('../src/full/story.json', import.meta.url);
http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (!['/api/video-demo', '/api/video-story'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(await readFile(request.url === '/api/video-story' ? story : fixture));
  } catch {
    response.writeHead(500).end('Mock fixture unavailable');
  }
}).listen(3101, '127.0.0.1', () => {
  console.log('Video mock data: http://127.0.0.1:3101/api/video-demo');
});
