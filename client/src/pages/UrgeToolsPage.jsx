import { useState } from 'react';
import Layout from '../components/Layout.jsx';

const STRATEGIES = [
  {
    section: 'Surf the Urge',
    emoji: '🌊',
    items: [
      {
        title: 'The Urge Wave',
        body: 'Urges peak like a wave — they rise, crest, and then fall. Most intense cravings last 15–20 minutes. You don’t have to give in; you just have to wait out the wave.',
        script: '"I don’t have to give in. I just have to wait 15 minutes."',
      },
      {
        title: 'Ride the 15-Minute Rule',
        body: 'Commit to doing anything else for 15 minutes. Set a timer. Tell yourself you can revisit the choice after the timer — most of the time the urge has softened.',
        script: '"I can wait 15 minutes. That’s all I need to do."',
      },
    ],
  },
  {
    section: 'Grounding Toolkit',
    emoji: '🌿',
    items: [
      {
        title: '5-4-3-2-1 Technique',
        body: 'Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. This pulls your brain out of the craving loop and back into the present.',
        script: '"Right now I can see… I can hear… I am here, not there."',
      },
      {
        title: 'Temperature Shock',
        body: 'Splash cold water on your face, hold an ice cube, or step into cooler air. The sudden temperature shift resets your nervous system and breaks the urge loop.',
        script: '"This sensation is strong — and it will pass."',
      },
    ],
  },
  {
    section: 'Cognitive Scripts',
    emoji: '🧠',
    items: [
      {
        title: 'This is a craving, not a command',
        body: 'The urge is a signal, not an order. You can notice it without obeying it.',
        script: '"I am anxious, not needing a fix."',
      },
      {
        title: 'Past vs Future Self',
        body: 'Ask: “Will my future self thank me for giving in right now?” Usually the answer is no.',
        script: '"I am choosing who I will become tomorrow."',
      },
      {
        title: 'HALT Check',
        body: 'Am I Hungry, Angry, Lonely, or Tired? Often the urge is a mask for a basic need. Fix the need, not the symptom.',
        script: '"I might just be hungry/tired. Let me fix that first."',
      },
    ],
  },
  {
    section: 'Emergency Actions',
    emoji: '🚨',
    items: [
      {
        title: 'Call a Support Contact',
        body: 'Have a pre-written list of people you can call when the urge hits. Connection is one of the fastest ways to break an urge cycle.',
        script: '"I don’t have to do this alone."',
      },
      {
        title: 'Change Your State',
        body: 'Move to a different room, step outside, or do 10 push-ups. Physical movement interrupts the mental loop.',
        script: '"I need to move, not stay here."',
      },
      {
        title: 'Delay & Distract',
        body: 'Play a quick game, watch a 3-minute video, or do a puzzle. Give your brain a new task with a clear end point.',
        script: '"I can come back to this feeling in 10 minutes."',
      },
    ],
  },
];

export default function UrgeToolsPage() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <Layout>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 className="page-title">Urge Toolkit</h1>
        <p className="page-sub">
          A library of strategies for when you need them. Bookmark this page — it’s here when you are.
        </p>

        {STRATEGIES.map((section, sIdx) => (
          <div key={sIdx} className="card" style={{ marginBottom: 14 }}>
            <p className="card-title" style={{ margin: '0 0 12px' }}>
              {section.emoji} {section.section}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {section.items.map((item, iIdx) => {
                const globalIdx = sIdx * 100 + iIdx;
                const isOpen = openIndex === globalIdx;
                return (
                  <div
                    key={iIdx}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      onClick={() => setOpenIndex(isOpen ? null : globalIdx)}
                      style={{
                        width: '100%',
                        background: 'var(--bg-soft)',
                        border: 'none',
                        color: 'var(--cream)',
                        padding: '14px 16px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{item.title}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{isOpen ? '▼' : '▶'}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                        <p style={{ margin: '0 0 10px', lineHeight: 1.6, fontSize: 14 }}>{item.body}</p>
                        <div
                          style={{
                            background: 'rgba(229,9,20,0.06)',
                            border: '1px solid rgba(229,9,20,0.18)',
                            borderRadius: 12,
                            padding: 12,
                          }}
                        >
                          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>SCRIPT</p>
                          <p style={{ margin: 0, fontSize: 14, fontStyle: 'italic', lineHeight: 1.5 }}>{item.script}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card" style={{ borderColor: 'rgba(168,192,154,0.35)' }}>
          <p className="card-title" style={{ margin: '0 0 8px' }}>🆘 Need immediate help?</p>
          <p className="muted small" style={{ margin: '0 0 12px' }}>
            If you are in crisis or feel like you might give in right now, reach out.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a href="tel:988" style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: 600 }}>📞 988 Suicide & Crisis Lifeline (US)</a>
            <a href="sms:741741&body=HELLO" style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: 600 }}>💬 Crisis Text Line — text HOME to 741741</a>
            <a href="/app/help" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>🧭 Open BreakFree Help page</a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
