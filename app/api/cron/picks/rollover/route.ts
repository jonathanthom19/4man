import { GET as runPicksCron } from '../route';

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set('rollover', '1');
  return runPicksCron(new Request(url, { headers: req.headers }));
}
