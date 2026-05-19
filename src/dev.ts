import { spawn } from 'node:child_process';
import path from 'node:path';

import './main';

const workerProcess = spawn(
	'tsx',
	[path.resolve('src/jobs/worker.ts')],
	{
		stdio: 'inherit',
		shell: true,
	},
);

function stopWorker() {
	if (!workerProcess.killed) {
		workerProcess.kill();
	}
}

process.on('SIGINT', stopWorker);
process.on('SIGTERM', stopWorker);
