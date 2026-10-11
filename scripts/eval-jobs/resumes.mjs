/**
 * The job search eval's resumes (spec section 9), as text the PDF writer renders at run time.
 * Every person and company here is fictional: no real person's data.
 */
import { imagePdf, noise, textPdf } from '../lib/pdf.mjs';

// A long career, for the three-page read (spikes note 5.1, item 4). Each line stays under 90
// characters, so the PDF writer never has to wrap one.
const longCareer = Array.from(
  { length: 120 },
  (_, n) =>
    `- Platform project ${n + 1}: ${4 + (n % 5)} engineers, ${2 + (n % 4)} months, ` +
    `incidents down ${5 + (n % 20)}%.`,
);

export const RESUMES = {
  'pm-london': {
    pages: [
      [
        'Priya Rao\nLondon, UK\n\nSenior Product Manager, Ledgerly\n2019 to now\n' +
          '- Led card payments for 40,000 small businesses\n- Cut failed payments by 18%\n\n' +
          'Product Manager, Tessera\n2016 to 2019\n- Built treasury dashboards for finance teams\n\n' +
          'Skills: payments, risk, B2B SaaS, SQL',
      ],
    ],
  },
  'backend-remote-us': {
    pages: [
      [
        'Marcus Bell\nDenver, CO, USA\n\nSenior Software Engineer, Quillstack\n2020 to now\n' +
          '- Built the billing service in Go and Postgres\n- Ran the on-call rotation for payments\n\n' +
          'Software Engineer, Harrowfield\n2016 to 2020\n- Wrote the order pipeline in Java\n\n' +
          'Skills: Go, Java, Postgres, Kafka, AWS',
      ],
    ],
  },
  'designer-nyc': {
    pages: [
      [
        'Ana Okafor\nBrooklyn, NY\n\nProduct Designer, Fernhill\n2021 to now\n' +
          '- Redesigned onboarding; activation up 12%\n- Built the design system\n\n' +
          'Designer, Gable & Finch\n2018 to 2021\n- Mobile banking app',
        'Skills\nFigma\nPrototyping\nUser research\nAccessibility\n\nEducation\nBFA, Interaction Design',
      ],
    ],
  },
  'em-toronto': {
    pages: [
      [
        `Daniel Wu\nToronto, ON, Canada\n\nEngineering Manager, Northbeam\n2018 to now\n${longCareer.slice(0, 40).join('\n')}`,
      ],
      [longCareer.slice(40, 80).join('\n')],
      [`${longCareer.slice(80).join('\n')}\n\nSkills: hiring, delivery, platform engineering`],
    ],
  },
  'growth-sf': {
    pages: [
      [
        'Sofia Marquez\nSan Francisco, CA\n\nDirector of Growth, Lumenly (Series B)\n2021 to now\n' +
          '- Grew paid users from 8,000 to 61,000\n- Built the lifecycle team\n\n' +
          'Growth Lead, Pebblepath\n2017 to 2021\n- Ran experiments across web and mobile\n\n' +
          'Skills: experimentation, SQL, lifecycle, paid acquisition',
      ],
    ],
  },
  'named-companies': {
    pages: [
      [
        'Jonas Weber\nLondon, UK\n\nProduct Manager, Corvid\n2020 to now\n' +
          '- Owned the lending application flow\n- Shipped instant decisions for small loans\n\n' +
          'Associate PM, Brightwater\n2018 to 2020\n\nSkills: lending, experimentation, SQL',
      ],
    ],
  },
  // A clean scan reads fine (spikes note 5.1, item 5), so the unreadable case is illegible.
  'blurred-scan': { scan: true },
};

/** A case's resume as PDF bytes. */
export function resumePdf(name) {
  const resume = RESUMES[name];

  return resume.scan ? imagePdf(400, 520, noise(400, 520)) : textPdf(resume.pages);
}
