import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // bypasses RLS — server-side only, never expose to client
);

export async function POST(req: Request) {
  const body = await req.json();
  const { device_id, frame_number, x, y, z, doppler_velocity } = body;

  await supabase.from("sensor_readings").insert({
    device_id,
    frame_number,
    x,
    y,
    z,
    doppler_velocity,
  });

  const isFall = z < 0.4 && Math.abs(doppler_velocity) > 1.5;

  if (isFall) {
    await supabase.from("fall_events").insert({
      device_id,
      z_drop: z,
      doppler_spike: doppler_velocity,
    });
    return NextResponse.json({ status: "fall_detected" });
  }

  return NextResponse.json({ status: "ok" });
}
