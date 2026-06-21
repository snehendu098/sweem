"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Payroll cycle volumes (placeholder), submitted vs approved per recent cycle.
const data = [
  { cycle: "Aug", submitted: 320, approved: 280 },
  { cycle: "Sep", submitted: 410, approved: 360 },
  { cycle: "Oct", submitted: 380, approved: 350 },
  { cycle: "Nov", submitted: 520, approved: 470 },
  { cycle: "Dec", submitted: 610, approved: 540 },
];

const chartConfig = {
  submitted: { label: "Submitted", color: "#024FA6" },
  approved: { label: "Approved", color: "#9ec3ea" },
} satisfies ChartConfig;

export function CyclesChart() {
  return (
    <ChartContainer config={chartConfig} className="mt-3 h-[272px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis
          dataKey="cycle"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          fontSize={12}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="submitted" fill="var(--color-submitted)" radius={[5, 5, 0, 0]} />
        <Bar dataKey="approved" fill="var(--color-approved)" radius={[5, 5, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
