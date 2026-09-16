import { createSignallingServer } from './signalling';

const { httpServer, io } = createSignallingServer();

httpServer.listen(3001, '127.0.0.1', () => {
  console.info('LearnThrive signalling listening on http://127.0.0.1:3001');
});
httpServer.on('error', (error) => {
  console.error('The signalling server could not start:', error.message);
  process.exitCode = 1;
});

function shutdown() {
  io.close(() => { process.exitCode = 0; });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
