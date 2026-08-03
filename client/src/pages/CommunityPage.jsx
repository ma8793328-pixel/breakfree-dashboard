import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { api, fetchBuddies, setBuddyOptIn } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';
import { containsFlagged, filterText } from '../contentFilter.js';

const EMOJIS = ['💪', '🎉', '🔥', '❤️', '🫶'];

const WIN_PRESETS = [
  { icon: '💪', text: "I resisted an urge today — one more win over this habit. 💪" },
  { icon: '💰', text: "Money saved this week instead of spent on the habit. 💰" },
  { icon: '🌱', text: "Day one. Starting over, starting fresh. Here we go. 🌱" },
  { icon: '🌿', text: "Checked in clean today. One day at a time. 🌿" },
  { icon: '🫶', text: "Just needed to say — you've got this, and we've got you. 🫶" },
];

function relativeTime(iso) {
  if (!iso) return '';
  const t = Date.parse(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Post({ post, token, currentUserId, onChanged, onDeleted, onBlock, blockingId }) {
  const [busy, setBusy] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reported, setReported] = useState(false);
  const inputRef = useRef(null);

  async function toggleReaction(emoji) {
    if (busy) return;
    setBusy(true);
    try {
      if (post.myReaction === emoji) {
        await api(`/community/posts/${post.id}/reactions`, { method: 'DELETE', token });
        post.myReaction = null;
      } else {
        await api(`/community/posts/${post.id}/reactions`, { method: 'POST', token, body: { emoji } });
        post.myReaction = emoji;
      }
      onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadComments() {
    if (comments) return;
    try {
      const data = await api(`/community/posts/${post.id}/comments`, { token });
      setComments(data.comments);
    } catch (e) {
      console.error(e);
    }
  }

  async function addComment() {
    const text = commentText.trim();
    if (!text || commentBusy) return;
    if (containsFlagged(text)) {
      const filtered = filterText(text);
      if (!confirm(`Your comment may contain inappropriate language.\n\nFiltered preview:\n"${filtered}"\n\nPost anyway?`)) return;
    }
    setCommentBusy(true);
    try {
      const data = await api(`/community/posts/${post.id}/comments`, { method: 'POST', token, body: { content: text } });
      setComments((prev) => [...(prev || []), data.comment]);
      setCommentText('');
      post.commentCount = (post.commentCount || 0) + 1;
      onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setCommentBusy(false);
    }
  }

  async function toggleFollow() {
    if (busy) return;
    setBusy(true);
    try {
      const endpoint = post.following ? '/community/unfollow' : '/community/follow';
      const data = await api(endpoint, { method: 'POST', token, body: { userId: post.userId } });
      post.following = data.following;
      onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function deletePost() {
    if (!confirm('Delete this post?')) return;
    try {
      await api(`/community/posts/${post.id}`, { method: 'DELETE', token });
      onDeleted(post.id);
    } catch (e) {
      console.error(e);
    }
  }

  async function submitReport() {
    if (!reportReason || reportBusy) return;
    setReportBusy(true);
    try {
      await api('/api/community/report', { method: 'POST', token, body: { postId: post.id, reason: reportReason } });
      setReported(true);
      setShowReport(false);
    } catch (e) {
      console.error(e);
    } finally {
      setReportBusy(false);
    }
  }

  function handleBlock() {
    if (onBlock) onBlock(post.userId, post.id);
  }

  const isBlocking = blockingId === post.id;

  const totalReactions = Object.values(post.reactions || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="post-card">
      <div className="post-head">
        <div className="post-avatar">{post.author?.charAt(0) || '?'}</div>
        <div className="post-meta">
          <p className="post-author">{post.author}</p>
          <p className="muted tiny">{relativeTime(post.createdAt)}</p>
        </div>
        <div className="post-actions">
          {post.isOwn ? (
            <button className="post-delete" onClick={deletePost} aria-label="Delete post">🗑️</button>
          ) : (
            <>
              {!showReport && !reported && !isBlocking && (
                <button className="post-more" onClick={() => setShowReport(true)} aria-label="Report or block">⋯</button>
              )}
              {isBlocking && <span className="muted tiny">Removing…</span>}
            </>
          )}
        </div>
      </div>

      {showReport && !reported && (
        <div className="report-form">
          <p className="card-title" style={{ margin: '0 0 6px' }}>Report post</p>
          <div className="report-options">
            {['Spam', 'Harassment', 'Self-harm', 'Other'].map((reason) => (
              <button
                key={reason}
                className={`chip ${reportReason === reason ? 'selected' : ''}`}
                onClick={() => setReportReason(reason)}
              >
                {reason}
              </button>
            ))}
          </div>
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={submitReport} disabled={!reportReason || reportBusy}>
              {reportBusy ? 'Submitting…' : 'Submit report'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowReport(false); setReportReason(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {reported && (
        <p className="muted small" style={{ padding: '6px 0' }}>✓ Report submitted. Thanks for keeping the community safe.</p>
      )}

      {post.habitName && (
        <p className="post-milestone">
          <span className="badge-pill streak">{post.streak > 0 ? `🔥 ${post.streak} days` : '🌱 Day one'}</span>{' '}
          <span className="muted small">with {post.habitName}</span>
        </p>
      )}

      {post.content && <p className="post-content">{post.content}</p>}

      <div className="post-reactions">
        {EMOJIS.map((e) => {
          const count = post.reactions?.[e] || 0;
          const mine = post.myReaction === e;
          return (
            <button
              key={e}
              className={`reaction-btn ${mine ? 'mine' : ''} ${count === 0 ? 'empty' : ''}`}
              onClick={() => toggleReaction(e)}
              disabled={busy}
            >
              <span>{e}</span>
              {count > 0 && <span className="reaction-count">{count}</span>}
            </button>
          );
        })}
        {totalReactions > 0 && <span className="reaction-total">{totalReactions}</span>}
      </div>

      <div className="post-foot">
        <button
          className={`comment-btn ${showComments ? 'active' : ''}`}
          onClick={() => {
            setShowComments((v) => !v);
            if (!showComments) {
              loadComments();
              setTimeout(() => inputRef.current?.focus(), 50);
            }
          }}
        >
          💬 {post.commentCount > 0 ? `${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}` : 'Support'}
        </button>
      </div>

      {showComments && (
        <div className="comments">
          {comments === null ? (
            <p className="muted small">Loading...</p>
          ) : comments.length === 0 ? (
            <p className="muted small">No comments yet — be the first to cheer them on.</p>
          ) : (
            comments.map((c) => (
              <div className="comment" key={c.id}>
                <span className="comment-avatar">{c.author?.charAt(0) || '?'}</span>
                <div className="comment-body">
                  <p className="comment-author">
                    {c.author} <span className="muted tiny">{relativeTime(c.createdAt)}</span>
                  </p>
                  <p className="comment-text">{c.content}</p>
                </div>
              </div>
            ))
          )}
          <div className="comment-input">
            <input
              ref={inputRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addComment()}
              placeholder="Send some support…"
              maxLength={280}
            />
            <button className="btn btn-primary btn-sm" onClick={addComment} disabled={commentBusy || !commentText.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommunityPage() {
  const { token, user } = useAuth();
  const { habits } = useHabits();
  const [username, setUsername] = useState(null);
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [feed, setFeed] = useState('global');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState('');
  const [attachHabit, setAttachHabit] = useState('');
  const [postBusy, setPostBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [buddyOptedIn, setBuddyOptedIn] = useState(false);
  const [buddies, setBuddies] = useState([]);
  const [buddyLoading, setBuddyLoading] = useState(true);
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [blockingId, setBlockingId] = useState(null);

  async function blockUser(userId, postId) {
    if (!confirm('Block this user? Their posts will no longer appear in your feed.')) return;
    setBlockingId(postId);
    try {
      await api('/api/community/block', { method: 'POST', token, body: { userId } });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setBlockingId(null);
    }
  }

  const refreshBuddies = async () => {
    try {
      const data = await fetchBuddies(token);
      setBuddyOptedIn(!!data.optedIn);
      setBuddies(data.buddies || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBuddyLoading(false);
    }
  };

  useEffect(() => {
    refreshBuddies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleBuddyOptIn() {
    setBuddyBusy(true);
    setError(null);
    try {
      const next = !buddyOptedIn;
      await setBuddyOptIn(next, token);
      setBuddyOptedIn(next);
      await refreshBuddies();
    } catch (e) {
      setError(e.message);
    } finally {
      setBuddyBusy(false);
    }
  }

  async function followBuddy(buddy) {
    try {
      const endpoint = buddy.following ? '/community/unfollow' : '/community/follow';
      const data = await api(endpoint, { method: 'POST', token, body: { userId: buddy.userId } });
      setBuddies((prev) => prev.map((b) => (b.userId === buddy.userId ? { ...b, following: data.following } : b)));
    } catch (e) {
      setError(e.message);
    }
  }

  const refreshPosts = async (which = feed, nextOffset = 0, append = false) => {
    try {
      const data = await api(`/community/posts?feed=${which}&limit=50&offset=${nextOffset}`, { token });
      setPosts((prev) => (append ? [...prev, ...data.posts] : data.posts));
      setOffset(nextOffset + data.posts.length);
      setHasMore(data.posts.length === 50);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api('/community/me', { token });
        if (active) setUsername(me.username);
      } catch (e) {
        if (active) setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    setLoading(true);
    refreshPosts(feed, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, token]);

  async function saveName() {
    const name = nameInput.trim();
    if (!name || nameBusy) return;
    setNameBusy(true);
    setNameError(null);
    try {
      const data = await api('/community/username', { method: 'PUT', token, body: { username: name } });
      setUsername(data.username);
      setEditName(false);
    } catch (e) {
      setNameError(e.message);
    } finally {
      setNameBusy(false);
    }
  }

  async function createPost() {
    const text = content.trim();
    if ((!text && !attachHabit) || postBusy) return;
    if (containsFlagged(text)) {
      const filtered = filterText(text);
      if (!confirm(`Your post may contain inappropriate language.\n\nFiltered preview:\n"${filtered}"\n\nPost anyway?`)) return;
    }
    setPostBusy(true);
    setError(null);
    try {
      await api('/community/posts', {
        method: 'POST',
        token,
        body: { content: text || undefined, habitId: attachHabit ? Number(attachHabit) : undefined },
      });
      setContent('');
      setAttachHabit('');
      refreshPosts(feed, 0, false);
    } catch (e) {
      setError(e.message);
    } finally {
      setPostBusy(false);
    }
  }

  function patchPost(id, fn) {
    setPosts((prev) => prev.map((p) => (p.id === id ? fn({ ...p }) : p)));
  }

  const currentUserId = user?.id;

  return (
    <Layout>
      <h1 className="page-title">🌍 Community</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Real people, real wins. Share your milestones, cheer on others, stay accountable together.
      </p>

      {username && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="post-avatar" style={{ width: 34, height: 34 }}>{username.charAt(0)}</span>
            <div style={{ flex: 1 }}>
              {editName ? (
                <>
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                    placeholder="Pick a name"
                    maxLength={20}
                    autoFocus
                  />
                  <div className="row mt" style={{ gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={saveName} disabled={nameBusy}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditName(false)}>Cancel</button>
                  </div>
                  {nameError && <p className="error-text small">{nameError}</p>}
                </>
              ) : (
                <>
                  <p className="settings-title" style={{ margin: 0 }}>@{username}</p>
                  <p className="muted tiny">That's how you appear — no one sees your email.</p>
                </>
              )}
            </div>
            {!editName && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setNameInput(username); setEditName(true); }}>
                ✏️ Change name
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 26 }}>🤝</span>
          <div style={{ flex: 1 }}>
            <p className="card-title" style={{ margin: 0 }}>Quit buddy</p>
            <p className="muted small" style={{ marginTop: 2 }}>
              Find someone quitting something similar, or starting around the same time as you.
            </p>
          </div>
          <button
            className={`btn btn-sm ${buddyOptedIn ? 'btn-primary' : 'btn-ghost'}`}
            onClick={toggleBuddyOptIn}
            disabled={buddyBusy}
          >
            {buddyOptedIn ? "✓ You're findable" : 'Opt in'}
          </button>
        </div>
        {buddyOptedIn && (
          <div style={{ marginTop: 12 }}>
            {buddyLoading ? (
              <p className="muted small">Looking for matches…</p>
            ) : buddies.length === 0 ? (
              <p className="muted small">
                No matches yet. Check back soon — when someone nearby quits something similar, you'll see them here.
              </p>
            ) : (
              <div className="list">
                {buddies.map((b) => (
                  <div className="list-item" key={b.userId}>
                    <span className="post-avatar" style={{ width: 32, height: 32 }}>{b.username.charAt(0)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{b.username}</div>
                      <div className="small muted">
                        {b.habitName} · {b.streak > 0 ? `🔥 ${b.streak} days clean` : '🌱 day one'}
                        {b.match === 'both' ? ' · same habit & start' : b.match === 'habit' ? ' · same habit' : ' · similar start'}
                      </div>
                    </div>
                    <button
                      className={`follow-btn ${b.following ? 'on' : ''}`}
                      onClick={() => followBuddy(b)}
                    >
                      {b.following ? '✓ Following' : '＋ Follow'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">Share an update</p>
        <p className="muted tiny" style={{ marginTop: -4 }}>
          Hit a milestone or resisted an urge? Tap a quick win below to post it in a second.
        </p>
        <div className="chip-row" style={{ margin: '4px 0 8px' }}>
          {WIN_PRESETS.map((w) => (
            <button
              key={w.icon}
              className="chip"
              onClick={() => setContent((prev) => (prev ? `${prev}\n${w.text}` : w.text))}
            >
              {w.icon} {w.text.split(' — ')[0].replace('You', 'You')}
            </button>
          ))}
        </div>
        <textarea
          className="composer"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="How's your journey going? Hit a milestone, had a hard day, or just want to say hi…"
          maxLength={280}
          rows={3}
        />
        <div className="row mt" style={{ alignItems: 'center' }}>
          <select className="habit-select" value={attachHabit} onChange={(e) => setAttachHabit(e.target.value)}>
            <option value="">Attach a habit (optional)</option>
            {habits.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.stats?.currentStreak || 0} days
              </option>
            ))}
          </select>
          <span className="muted tiny" style={{ marginLeft: 'auto' }}>{content.length}/280</span>
        </div>
        <button className="btn btn-primary btn-block mt" onClick={createPost} disabled={postBusy}>
          {postBusy ? 'Posting…' : '📣 Share with the community'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="feed-tabs">
        <button className={feed === 'global' ? 'active' : ''} onClick={() => setFeed('global')}>
          Everyone
        </button>
        <button className={feed === 'following' ? 'active' : ''} onClick={() => setFeed('following')}>
          Following
        </button>
      </div>

      {loading ? (
        <div className="center" style={{ padding: 30 }}>
          <div className="spinner" />
        </div>
      ) : posts.length === 0 ? (
        <div className="card center">
          <p className="muted">
            {feed === 'following'
              ? 'Nothing from the people you follow yet. Follow people from the Everyone tab.'
              : 'No posts yet. Be the first to share your journey!'}
          </p>
        </div>
      ) : (
        <>
          {posts.map((p) => (
            <Post
              key={p.id}
              post={{ ...p, isOwn: p.userId === currentUserId }}
              token={token}
              currentUserId={currentUserId}
              onChanged={() => patchPost(p.id, (n) => ({ ...n, myReaction: p.myReaction, following: p.following }))}
              onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
              onBlock={blockUser}
              blockingId={blockingId}
            />
          ))}
          {hasMore && (
            <button className="btn btn-ghost btn-block" onClick={() => refreshPosts(feed, offset, true)}>
              Load more
            </button>
          )}
        </>
      )}
    </Layout>
  );
}
