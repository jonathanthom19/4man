import { getHistory, deleteHistoryEntry } from '@/lib/history-store';

export async function GET() {
  try {
    const history = await getHistory();
    return Response.json({ history });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
    await deleteHistoryEntry(id);
    const history = await getHistory();
    return Response.json({ history });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
