import type { Metadata } from 'next'
import App from '@/components/App'

export const metadata: Metadata = { title: 'AgriReuse demo' }

export default function AppPage() {
  return <App />
}
