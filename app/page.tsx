import type { Metadata } from 'next'
import Link from 'next/link'
import AuthRedirect from '@/components/AuthRedirect'

export const metadata: Metadata = {
  title: 'AgriReuse: turn farm waste into value',
  description: 'A farm waste marketplace for New Zealand: list by voice, get a safety check, and see cost, transport and carbon savings before the deal.',
}

const STEPS: [string, string, string][] = [
  ['🎤', 'Say what you have', 'Tell our assistant about your waste by voice or text. No long forms.'],
  ['🛡️', 'Safety check', 'We check the item and mark it as eligible, restricted or blocked.'],
  ['🤝', 'Get matched', 'See buyers who can use it, and why each one is a good match.'],
  ['📊', 'See the numbers', 'Transport, money made or saved, and carbon saved, all before you agree.'],
  ['✅', 'Make the deal', 'Follow simple steps from offer to pickup, with options to cancel or raise a problem.'],
  ['🌍', 'See your impact', 'Track the waste reused and the carbon saved on your dashboard.'],
]

const WHY: [string, string][] = [
  ['Voice-first', 'List in seconds by just speaking.'],
  ['Safety check built in', 'Items are checked before they’re listed.'],
  ['No surprises', 'Cost, transport and carbon are shown up front.'],
  ['Clear matches', 'You see why each buyer was suggested.'],
  ['All farm waste', 'Not just food, but crop leftovers, processing leftovers and spare feed too.'],
]

const WHO: [string, string, string][] = [
  ['🚜', 'Farmers and growers', 'Earn from waste instead of paying to get rid of it.'],
  ['♻️', 'Buyers', 'Composters, processors and other farms get local material at low cost.'],
  ['🇳🇿', 'New Zealand', 'Less waste and fewer emissions, supporting the goal of 15% circular material use by 2035.'],
]

export default function Landing() {
  return (
    <div className="landing">
      <AuthRedirect />
      <header>
        <b>🌱 AgriReuse</b>
        <span className="demo">Payments simulated</span>
        <span className="header-actions">
          <Link className="btn alt" href="/app?mode=in">Sign in</Link>
          <Link className="btn" href="/app?mode=up">Sign up</Link>
        </span>
      </header>

      <main>
        <section className="hero landing-hero">
          <h1>Turn farm waste into value.</h1>
          <p>
            AgriReuse helps New Zealand farmers find buyers for leftover produce, crop residues and other farm waste,
            with a safety check, cost and carbon savings shown before the deal.
          </p>
          <Link className="btn" href="/app?mode=up">Try the demo</Link>{' '}
          <a className="btn alt" href="#how">See how it works</a>
        </section>

        <section className="card">
          <h2>What is AgriReuse?</h2>
          <p>
            AgriReuse is a farm waste marketplace for New Zealand. Farmers list what they have left over, and AgriReuse
            matches it with people who can reuse it, such as composters, processors and other farms. You can list by voice,
            every item gets a safety check, and you see the cost, transport and carbon savings before you agree to a deal.
          </p>
        </section>

        <section id="how">
          <h2>How it works</h2>
          <ol className="grid steps">
            {STEPS.map(([icon, title, text], i) => (
              <li className="card" key={title}>
                <div className="step-num">{i + 1}</div>
                <h3>{icon} {title}</h3>
                <p className="s">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Why AgriReuse</h2>
          <div className="grid">
            {WHY.map(([title, text]) => (
              <div className="card" key={title}>
                <h3>✔ {title}</h3>
                <p className="s">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Who it’s for</h2>
          <div className="grid">
            {WHO.map(([icon, title, text]) => (
              <div className="card" key={title}>
                <div className="big">{icon}</div>
                <h3>{title}</h3>
                <p className="s">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card cta">
          <h2>Ready to give your waste a second life?</h2>
          <Link className="btn" href="/app?mode=up">Sign up</Link>{' '}
          <Link className="btn alt" href="/app?mode=in">Sign in</Link>
        </section>
      </main>

      <footer>
        <div className="warn">
          Payments are simulated: no real money is collected, held or released.
        </div>
      </footer>
    </div>
  )
}
