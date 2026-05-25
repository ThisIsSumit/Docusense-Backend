import { spawn } from 'node:child_process';
import path from 'node:path';

import './main';

const runWorkerInline =
	(process.env.RUN_WORKER_INLINE ?? '').toLowerCase() === 'true';

const workerProcess = runWorkerInline
	? null
	: spawn(
		'tsx',
		[path.resolve('src/jobs/worker.ts')],
		{
			stdio: 'inherit',
			shell: true,
		},
	);

if (runWorkerInline) {
	console.log('RUN_WORKER_INLINE=true, skipping separate dev worker spawn.');
}

function stopWorker() {
	if (workerProcess && !workerProcess.killed) {
		workerProcess.kill();
	}
}

process.on('SIGINT', stopWorker);
process.on('SIGTERM', stopWorker);
