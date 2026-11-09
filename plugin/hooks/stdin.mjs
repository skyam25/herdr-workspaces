const STDIN_MS = 1000;

// Gives up after a second, so a hook never hangs on an open pipe.
export async function readStdin() {
  const chunks = [];
  const finished = (async () => {
    for await (const chunk of process.stdin) chunks.push(chunk);
  })();

  let timer;
  await Promise.race([finished, new Promise((resolve) => (timer = setTimeout(resolve, STDIN_MS)))]);
  clearTimeout(timer);

  return Buffer.concat(chunks).toString("utf8");
}
