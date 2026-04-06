import { heartbeat, getActive } from '@/lib/presence-store';

export async function GET() {
  try {
    const users = await getActive();
    return Response.json({ users });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json() as { name: string };
    if (!name?.trim()) return Response.json({ error: 'name is required' }, { status: 400 });
    await heartbeat(name.trim());
    const users = await getActive();
    return Response.json({ users });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
