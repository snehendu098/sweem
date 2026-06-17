import { Reveal } from "@/components/motion/reveal";
import { TestimonialCard } from "@/components/testimonials/testimonial-card";

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MazeLogo() {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#101828]">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M3 7c3-4 6 4 9 0s6-4 9 0" strokeLinecap="round" />
        <path d="M3 14c3-4 6 4 9 0s6-4 9 0" strokeLinecap="round" />
      </svg>
      maze
    </div>
  );
}

function AsanaLogo() {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#101828]">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <circle cx="12" cy="8" r="4" fill="#f06a6a" />
        <circle cx="5" cy="17" r="3.5" fill="#f06a6a" />
        <circle cx="19" cy="17" r="3.5" fill="#f06a6a" />
      </svg>
      asana
    </div>
  );
}

function MonzoLogo() {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#101828]">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path d="M4 18V6l4 6 4-6 4 6 4-6v12" fill="none" stroke="#f4511e" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      monzo
    </div>
  );
}

function SquareLogo() {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#101828]">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="#101828" strokeWidth="2" />
        <rect x="7" y="7" width="10" height="10" rx="1.5" fill="#101828" />
      </svg>
      Square
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <section className="bg-white px-24 py-20">
      <div className="w-full">
        {/* header */}
        <Reveal className="mb-10 flex items-start justify-between gap-8">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
              <ClockIcon />
              Testimonials
            </p>
            <h2 className="mt-3 text-[33px] font-medium leading-[1.1] tracking-[-0.02em] text-[#101828] md:text-[42px]">
              Trusted Worldwide by<br />Growing Businesses
            </h2>
          </div>
          <p className="mt-[76px] hidden max-w-[340px] text-[12px] leading-6 text-[#667085] md:block">
            Real stories from teams who rely on our platform<br />for secure, seamless, and scalable payments.
          </p>
        </Reveal>

        {/* row 1 */}
        <div className="grid grid-cols-3 items-stretch gap-4">
          <Reveal>
            <TestimonialCard type="image" brand="Eightball" bg="linear-gradient(160deg,#c8dff0,#e8f4fc)" />
          </Reveal>
          <Reveal delay={0.06}>
            <TestimonialCard
              type="quote"
              logo={<MazeLogo />}
              quote='"Cross-border payments used to slow us down. Now transactions move effortlessly with full visibility."'
              name="Marcus Lee"
              role="Head of Finance Operations"
            />
          </Reveal>
          <Reveal delay={0.1}>
            <TestimonialCard
              type="quote"
              logo={<AsanaLogo />}
              quote='"The checkout experience is incredibly smooth. Our customers trust it, and so do we."'
              name="Nina Roberts"
              role="Product Lead"
              light
            />
          </Reveal>
        </div>

        {/* row 2 */}
        <div className="mt-4 grid grid-cols-3 items-stretch gap-4">
          <Reveal>
            <TestimonialCard
              type="quote"
              logo={<MonzoLogo />}
              quote='"Handling high transaction volumes is no longer stressful. Security and performance are rock solid."'
              name="Ethan Walker"
              role="Co-Founder"
              light
            />
          </Reveal>
          <Reveal delay={0.06}>
            <TestimonialCard
              type="quote"
              logo={<SquareLogo />}
              quote='"This platform gave us confidence to scale globally without worrying about compliance or failures."'
              name="Daniel Morgan"
              role="Founder & CEO"
            />
          </Reveal>
          <Reveal delay={0.1}>
            <TestimonialCard type="image" brand="Nulig" bg="linear-gradient(160deg,#1a3a2a,#2d5c42)" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
