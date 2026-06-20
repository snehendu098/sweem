import Image from "next/image";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Image src="/sweem.png" alt="Sweem" width={26} height={26} priority className="h-[26px] w-[26px]" />
      <span className={`text-[18px] font-semibold tracking-tight ${dark ? "text-white" : "text-[#101828]"}`}>
        Sweem
      </span>
    </div>
  );
}
