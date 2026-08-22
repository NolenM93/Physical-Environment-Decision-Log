import { NextResponse } from 'next/server';
import { categoryFromLabel } from '@/lib/domain/catalog';
import type { Detection2D } from '@/lib/domain/types';

/**
 * Optional cloud object detection.
 *
 * Stanza works entirely offline: you can box furniture by hand and the
 * calibration maths does the rest. This route exists for people who would
 * rather let a vision model do the boxing, and it is opt-in by configuration
 * precisely because it is the one code path that sends a photo of the inside
 * of your home somewhere else.
 *
 * Configure with any OpenAI-compatible chat completions endpoint:
 *   STANZA_VISION_BASE_URL   default https://api.openai.com/v1
 *   STANZA_VISION_API_KEY
 *   STANZA_VISION_MODEL      default gpt-4o-mini
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You locate furniture in photographs of domestic interiors.

Return ONLY a JSON object of the form:
{"objects":[{"label":"grey three-seater sofa","category":"sofa","x":0.11,"y":0.42,"width":0.38,"height":0.29,"score":0.9,"baseOccluded":false}]}

Rules:
- x, y, width, height are fractions of the image, with (0,0) at the top-left.
- The box must tightly enclose the object INCLUDING the point where it meets the floor. That bottom edge is used to measure real-world position, so it matters more than the top.
- Set baseOccluded to true when the bottom of the object is hidden behind something else or cropped by the frame.
- category must be one of: sofa, sectional, armchair, ottoman, coffee_table, side_table, console, dining_table, dining_chair, desk, office_chair, bed, nightstand, dresser, wardrobe, bookshelf, tv, media_unit, rug, floor_lamp, table_lamp, plant, piano, exercise, storage_bin, refrigerator, range, dishwasher, counter, island, washer_dryer, crib, other.
- Include only furniture and large objects that sit on the floor or are mounted on a wall. Ignore cushions, books, and clutter.
- No prose, no markdown fences.`;

interface RawObject {
  label?: string;
  category?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  score?: number;
  baseOccluded?: boolean;
}

export async function POST(request: Request) {
  const apiKey = process.env.STANZA_VISION_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'not-configured',
        message:
          'No vision provider is configured. Set STANZA_VISION_API_KEY (and optionally STANZA_VISION_BASE_URL and STANZA_VISION_MODEL) to enable automatic detection. Everything else works without it — draw boxes by hand and the calibration still measures them.',
      },
      { status: 501 },
    );
  }

  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', message: 'Expected JSON.' }, { status: 400 });
  }

  if (!body.image?.startsWith('data:image/')) {
    return NextResponse.json(
      { error: 'bad-request', message: 'Expected an image data URL.' },
      { status: 400 },
    );
  }

  const baseUrl = process.env.STANZA_VISION_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.STANZA_VISION_MODEL ?? 'gpt-4o-mini';

  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Find the furniture in this room.' },
              { type: 'image_url', image_url: { url: body.image, detail: 'high' } },
            ],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: 'upstream', message: `Vision provider returned ${upstream.status}: ${text.slice(0, 400)}` },
        { status: 502 },
      );
    }

    const json = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(stripFences(content)) as { objects?: RawObject[] };

    const detections: Detection2D[] = (parsed.objects ?? [])
      .filter((o) => typeof o.x === 'number' && typeof o.y === 'number')
      .map((o, i) => {
        const label = o.label?.trim() || 'Object';
        return {
          id: `ai-${i}`,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          category: categoryFromLabel(o.category || label),
          box: {
            x: clamp01(o.x ?? 0),
            y: clamp01(o.y ?? 0),
            width: clamp01(o.width ?? 0.1),
            height: clamp01(o.height ?? 0.1),
          },
          score: typeof o.score === 'number' ? Math.max(0, Math.min(1, o.score)) : 0.7,
          baseOccluded: Boolean(o.baseOccluded),
        };
      })
      .filter((d) => d.box.width > 0.01 && d.box.height > 0.01);

    return NextResponse.json({ detections, model });
  } catch (error) {
    return NextResponse.json(
      { error: 'failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}
