// Run tasks with a fixed concurrency limit.
// Safe in single-threaded JS: the index increment is synchronous.
export async function concurrent(
	tasks: (() => Promise<void>)[],
	limit: number,
): Promise<void> {
	let i = 0;
	const worker = async () => {
		while (i < tasks.length) {
			await tasks[i++]();
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, tasks.length) }, worker),
	);
}
