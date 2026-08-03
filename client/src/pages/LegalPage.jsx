import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';

const TERMS_URL = '/legal/terms';
const PRIVACY_URL = '/legal/privacy';

export default function LegalPage({ kind }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = kind === 'privacy' ? PRIVACY_URL : TERMS_URL;
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Unable to load this page. Please try again later.'))
      .finally(() => setLoading(false));
  }, [kind]);

  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';

  return (
    <Layout>
      <div className="legal-page">
        <h1 className="page-title">{title}</h1>
        <p className="legal-meta">Last updated: August 2026</p>
        {loading ? (
          <div className="loading-screen" style={{ minHeight: '30vh' }}>
            <div className="spinner" />
          </div>
        ) : (
          <div className="card legal-body">
            {text.split('\n').map((line, i) => (
              <p key={i} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{line || <br />}</p>
            ))}
          </div>
        )}
        <p className="center muted small mt">
          Questions? <a href="mailto:support@breakfree.app">support@breakfree.app</a>
        </p>
      </div>
    </Layout>
  );
}
