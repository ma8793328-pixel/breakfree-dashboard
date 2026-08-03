import { db } from './db.js';
import { computeStats } from './stats.js';

const COMMUNITY_EMOJIS = ['💪', '🎉', '🔥', '❤️', '🫶'];
const NAME_ADJ = ['Brave', 'Calm', 'Clever', 'Cosmic', 'Courageous', 'Dawn', 'Fierce', 'Gentle', 'Golden', 'Hopeful', 'Kind', 'Lucky', 'Mellow', 'Mighty', 'Mindful', 'Peaceful', 'Radiant', 'Resilient', 'Serene', 'Shining', 'Silent', 'Sincere', 'Steady', 'Strong', 'Sunny', 'Swift', 'Tender', 'True', 'Warm', 'Wise'];
const NAME_NOUN = ['Bear', 'Breeze', 'Canyon', 'Cedar', 'Dove', 'Eagle', 'Fern', 'Fox', 'Harbor', 'Journey', 'Lark', 'Lotus', 'Meadow', 'Oak', 'Otter', 'Pine', 'River', 'Rose', 'Skylark', 'Spring', 'Star', 'Stone', 'Sunrise', 'Thistle', 'Valley', 'Wave', 'Willow', 'Wren'];

function randomUsername() {
  const a = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
  const n = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
  return `${a}${n}${Math.floor(10 + Math.random() * 90)}`;
}

function validUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u || '');
}

function ensureUsername(userId) {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (user?.username) return user.username;
  for (let i = 0; i < 6; i++) {
    const name = randomUsername();
    try {
      const r = db.prepare('UPDATE users SET username = ? WHERE id = ? AND username IS NULL').run(name, userId);
      if (r.changes > 0) return name;
    } catch {
      /* name collision — try again */
    }
  }
  return 'Anonymous';
}

function communityPosts(userId, feed, limit, offset) {
  const following = feed === 'following';
  const blocked = db
    .prepare(
      `SELECT blocked_id FROM community_blocks WHERE blocker_id = ?
       UNION
       SELECT blocker_id FROM community_blocks WHERE blocked_id = ?`
    )
    .all(userId, userId);
  const blockedIds = blocked.map((b) => b.blocked_id);
  const blockedIn = blockedIds.length > 0 ? `p.user_id NOT IN (${blockedIds.map(() => '?').join(',')})` : '1=1';
  const rows = following
    ? db
        .prepare(
          `SELECT p.id, p.user_id, p.content, p.habit_name, p.streak, p.badge, p.created_at,
                  COALESCE(u.username, 'Anonymous') AS author_username,
                  (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comment_count
           FROM community_posts p JOIN users u ON u.id = p.user_id
           WHERE (p.user_id IN (SELECT following_id FROM community_follows WHERE follower_id = ?) OR p.user_id = ?)
             AND ${blockedIn}
           ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
        )
        .all(userId, userId, ...blockedIds, limit, offset)
    : db
        .prepare(
          `SELECT p.id, p.user_id, p.content, p.habit_name, p.streak, p.badge, p.created_at,
                  COALESCE(u.username, 'Anonymous') AS author_username,
                  (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comment_count
           FROM community_posts p JOIN users u ON u.id = p.user_id
           WHERE ${blockedIn}
           ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
        )
        .all(...blockedIds, limit, offset);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const inClause = ids.map(() => '?').join(',');
  const reactionRows = db
    .prepare(`SELECT post_id, emoji, COUNT(*) AS n FROM community_reactions WHERE post_id IN (${inClause}) GROUP BY post_id, emoji`)
    .all(...ids);
  const myReactions = db
    .prepare(`SELECT post_id, emoji FROM community_reactions WHERE user_id = ? AND post_id IN (${inClause})`)
    .all(userId, ...ids);
  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const authorIn = authorIds.map(() => '?').join(',');
  const follows = db
    .prepare(`SELECT following_id FROM community_follows WHERE follower_id = ? AND following_id IN (${authorIn})`)
    .all(userId, ...authorIds);
  const reactionsByPost = {};
  for (const r of reactionRows) {
    (reactionsByPost[r.post_id] = reactionsByPost[r.post_id] || {})[r.emoji] = Number(r.n);
  }
  const myByPost = Object.fromEntries(myReactions.map((r) => [r.post_id, r.emoji]));
  const followSet = new Set(follows.map((f) => f.following_id));
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    content: r.content,
    habitName: r.habit_name,
    streak: r.streak,
    badge: r.badge,
    createdAt: r.created_at,
    author: r.author_username,
    reactions: reactionsByPost[r.id] || {},
    myReaction: myByPost[r.id] || null,
    commentCount: Number(r.comment_count || 0),
    following: followSet.has(r.user_id),
  }));
}

function postComments(postId, viewerId) {
  const blocked = db
    .prepare(
      `SELECT blocked_id FROM community_blocks WHERE blocker_id = ?
       UNION
       SELECT blocker_id FROM community_blocks WHERE blocked_id = ?`
    )
    .all(viewerId, viewerId);
  const blockedIds = blocked.map((b) => b.blocked_id);
  const blockedIn = blockedIds.length > 0 ? `AND cm.user_id NOT IN (${blockedIds.map(() => '?').join(',')})` : '';
  return db
    .prepare(
      `SELECT cm.id, cm.content, cm.created_at, COALESCE(u.username, 'Anonymous') AS author, cm.user_id
       FROM community_comments cm JOIN users u ON u.id = cm.user_id
       WHERE cm.post_id = ? ${blockedIn} ORDER BY cm.created_at, cm.id`
    )
    .all(postId, ...blockedIds);
}

export function registerCommunityRoutes(app, { requireAuth, requireAdmin, habitForUser }) {
  app.get('/api/community/me', requireAuth, (req, res) => {
    res.json({ username: ensureUsername(req.user.id) });
  });

  app.put('/api/community/username', requireAuth, (req, res) => {
    const name = String(req.body?.username || '').trim();
    if (!validUsername(name)) {
      return res.status(400).json({ error: 'Pick 3–20 letters, numbers or underscores.' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(name);
    if (taken) return res.status(409).json({ error: 'That name is taken — try another.' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, req.user.id);
    res.json({ username: name });
  });

  app.get('/api/community/posts', requireAuth, (req, res) => {
    const feed = req.query.feed === 'following' ? 'following' : 'global';
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json({ posts: communityPosts(req.user.id, feed, limit, offset) });
  });

  app.post('/api/community/posts', requireAuth, (req, res) => {
    ensureUsername(req.user.id);
    const { content, habitId } = req.body || {};
    let text = String(content || '').trim();
    let habitName = null;
    let streak = null;
    let badge = null;
    if (habitId) {
      const habit = habitForUser(Number(habitId), req.user.id);
      if (!habit) return res.status(404).json({ error: 'Habit not found.' });
      const checkins = db.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').all(habit.id);
      const stats = computeStats(checkins, habit.daily_cost, habit.daily_time, habit.units_per_day);
      habitName = habit.name;
      streak = stats.currentStreak;
      if (!text) {
        text =
          streak > 0
            ? `Hit a ${streak}-day clean streak with ${habit.name}. One day at a time.`
            : `Starting over with ${habit.name}. Day one, here we go.`;
      }
    }
    if (!text) return res.status(400).json({ error: 'Write something to share.' });
    if (text.length > 280) return res.status(400).json({ error: 'Keep it under 280 characters.' });
    const info = db
      .prepare('INSERT INTO community_posts (user_id, content, habit_name, streak, badge) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, text.slice(0, 280), habitName, streak, badge);
    res.status(201).json({ ok: true, postId: Number(info.lastInsertRowid) });
  });

  app.delete('/api/community/posts/:id', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM community_posts WHERE id = ?').get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    db.prepare('DELETE FROM community_posts WHERE id = ?').run(post.id);
    res.json({ ok: true });
  });

  app.post('/api/community/posts/:id/reactions', requireAuth, (req, res) => {
    const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const { emoji } = req.body || {};
    if (!COMMUNITY_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Unsupported reaction.' });
    db.prepare(
      `INSERT INTO community_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)
       ON CONFLICT(post_id, user_id) DO UPDATE SET emoji = excluded.emoji`
    ).run(post.id, req.user.id, emoji);
    res.json({ ok: true, emoji });
  });

  app.delete('/api/community/posts/:id/reactions', requireAuth, (req, res) => {
    db.prepare('DELETE FROM community_reactions WHERE post_id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/community/posts/:id/comments', requireAuth, (req, res) => {
    const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.json({ comments: postComments(post.id, req.user.id) });
  });

  app.post('/api/community/posts/:id/comments', requireAuth, (req, res) => {
    ensureUsername(req.user.id);
    const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const text = String(req.body?.content || '').trim();
    if (!text) return res.status(400).json({ error: 'Write a comment.' });
    if (text.length > 280) return res.status(400).json({ error: 'Keep it under 280 characters.' });
    const info = db
      .prepare('INSERT INTO community_comments (post_id, user_id, content) VALUES (?, ?, ?)')
      .run(post.id, req.user.id, text.slice(0, 280));
    const comment = db
      .prepare(
        `SELECT cm.id, cm.content, cm.created_at, COALESCE(u.username, 'Anonymous') AS author, cm.user_id
         FROM community_comments cm JOIN users u ON u.id = cm.user_id WHERE cm.id = ?`
      )
      .get(Number(info.lastInsertRowid));
    res.status(201).json({ comment });
  });

  app.post('/api/community/follow', requireAuth, (req, res) => {
    const target = Number(req.body?.userId);
    if (!Number.isInteger(target) || target === req.user.id) {
      return res.status(400).json({ error: 'Invalid user.' });
    }
    db.prepare('INSERT OR IGNORE INTO community_follows (follower_id, following_id) VALUES (?, ?)').run(
      req.user.id,
      target
    );
    res.json({ ok: true, following: true });
  });

  app.post('/api/community/unfollow', requireAuth, (req, res) => {
    db.prepare('DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?').run(
      req.user.id,
      Number(req.body?.userId)
    );
    res.json({ ok: true, following: false });
  });

  // ---------- moderation ----------

  app.post('/api/community/report', requireAuth, (req, res) => {
    const { postId, commentId, reason } = req.body || {};
    const targetId = postId ? Number(postId) : commentId ? Number(commentId) : null;
    if (!targetId) return res.status(400).json({ error: 'Nothing to report.' });
    const reasonText = String(reason || '').trim().slice(0, 100);
    if (!reasonText) return res.status(400).json({ error: 'Choose a reason.' });
    const allowed = ['Spam', 'Harassment', 'Self-harm', 'Inappropriate', 'Other'];
    if (!allowed.includes(reasonText)) return res.status(400).json({ error: 'Invalid reason.' });

    let exists;
    if (postId) {
      exists = db.prepare('SELECT 1 AS one FROM community_posts WHERE id = ?').get(targetId);
      if (!exists) return res.status(404).json({ error: 'Post not found.' });
    } else {
      exists = db.prepare('SELECT 1 AS one FROM community_comments WHERE id = ?').get(targetId);
      if (!exists) return res.status(404).json({ error: 'Comment not found.' });
    }

    const prior = db
      .prepare(
        `SELECT id FROM community_reports
         WHERE reporter_id = ? AND post_id IS ? AND comment_id IS ? AND status = 'open'`
      )
      .get(req.user.id, postId ? targetId : null, commentId ? targetId : null);
    if (prior) return res.json({ ok: true, already: true });

    db.prepare(
      `INSERT INTO community_reports (reporter_id, post_id, comment_id, reason)
       VALUES (?, ?, ?, ?)`
    ).run(req.user.id, postId ? targetId : null, commentId ? targetId : null, reasonText);
    res.status(201).json({ ok: true });
  });

  app.post('/api/community/block', requireAuth, (req, res) => {
    const target = Number(req.body?.userId);
    if (!Number.isInteger(target) || target === req.user.id) {
      return res.status(400).json({ error: 'Invalid user.' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(target);
    if (!exists) return res.status(404).json({ error: 'User not found.' });
    db.prepare('INSERT OR IGNORE INTO community_blocks (blocker_id, blocked_id) VALUES (?, ?)').run(
      req.user.id,
      target
    );
    db.prepare('DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target);
    res.status(201).json({ ok: true });
  });

  app.get('/api/community/moderation', requireAuth, requireAdmin, (req, res) => {
    const reports = db
      .prepare(
        `SELECT r.id, r.reason, r.status, r.action, r.created_at,
                reporter.id AS reporter_id, COALESCE(reporter.username, 'Anonymous') AS reporter,
                COALESCE(author.id, '') AS author_id, COALESCE(author.username, '') AS author,
                r.post_id, r.comment_id,
                COALESCE(p.content, '') AS post_content,
                COALESCE(cm.content, '') AS comment_content,
                p.created_at AS post_created_at
         FROM community_reports r
         JOIN users reporter ON reporter.id = r.reporter_id
         LEFT JOIN community_posts p ON p.id = r.post_id
         LEFT JOIN community_comments cm ON cm.id = r.comment_id
         LEFT JOIN users author ON author.id = COALESCE(p.user_id, cm.user_id)
         ORDER BY (r.status = 'open') DESC, r.id DESC`
      )
      .all();
    res.json({ reports });
  });

  app.post('/api/community/moderation/:id', requireAuth, requireAdmin, (req, res) => {
    const report = db.prepare('SELECT * FROM community_reports WHERE id = ?').get(Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    const action = String(req.body?.action || '');
    if (!['dismiss', 'remove', 'block'].includes(action)) {
      return res.status(400).json({ error: 'Action must be dismiss, remove or block.' });
    }
    if (action === 'dismiss') {
      db.prepare(
        "UPDATE community_reports SET status = 'resolved', action = 'dismiss', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
      ).run(req.user.id, report.id);
      return res.json({ ok: true, action });
    }
    if (action === 'remove') {
      if (report.post_id) {
        db.prepare('DELETE FROM community_posts WHERE id = ?').run(report.post_id);
      } else if (report.comment_id) {
        db.prepare('DELETE FROM community_comments WHERE id = ?').run(report.comment_id);
      } else {
        return res.status(400).json({ error: 'Report has no target.' });
      }
      db.prepare(
        "UPDATE community_reports SET status = 'resolved', action = 'remove', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
      ).run(req.user.id, report.id);
      return res.json({ ok: true, action });
    }
    // action === 'block' — block the author site-wide, remove their content
    const targetUserId = report.post_id
      ? db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(report.post_id)?.user_id
      : report.comment_id
        ? db.prepare('SELECT user_id FROM community_comments WHERE id = ?').get(report.comment_id)?.user_id
        : null;
    if (targetUserId) {
      const blockers = db
        .prepare("SELECT id FROM users WHERE role != 'admin' AND id != ?")
        .all(targetUserId)
        .map((u) => u.id);
      for (const blockerId of blockers) {
        db.prepare('INSERT OR IGNORE INTO community_blocks (blocker_id, blocked_id) VALUES (?, ?)').run(
          blockerId,
          targetUserId
        );
      }
      db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(targetUserId);
      db.prepare('DELETE FROM community_comments WHERE user_id = ?').run(targetUserId);
    }
    db.prepare(
      "UPDATE community_reports SET status = 'resolved', action = 'block', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?"
    ).run(req.user.id, report.id);
    res.json({ ok: true, action });
  });

  // ---------- quit buddies ----------
  function normalizeHabitName(n) {
    return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function buddyMatches(userId) {
    const me = db.prepare('SELECT buddy_opt_in FROM users WHERE id = ?').get(userId);
    const optedIn = Number(me?.buddy_opt_in || 0) === 1;
    const myHabits = db.prepare('SELECT name, start_date FROM habits WHERE user_id = ? ORDER BY start_date').all(userId);
    const myPrimary = myHabits[0];
    if (!myPrimary) return { optedIn, buddies: [] };
    const myName = normalizeHabitName(myPrimary.name);
    const candidates = db
      .prepare('SELECT id, username FROM users WHERE buddy_opt_in = 1 AND id != ? AND username IS NOT NULL')
      .all(userId);
    const buddies = [];
    for (const cand of candidates) {
      const ch = db
        .prepare(
          'SELECT name, start_date, id FROM habits WHERE user_id = ? ORDER BY ABS(julianday(start_date) - julianday(?)) LIMIT 1'
        )
        .get(cand.id, myPrimary.start_date);
      if (!ch) continue;
      const sameName = normalizeHabitName(ch.name) === myName;
      const daysDiff = Math.abs(Math.round((new Date(ch.start_date) - new Date(myPrimary.start_date)) / 86400000));
      const startClose = daysDiff <= 21;
      const match = sameName && startClose ? 'both' : sameName ? 'habit' : startClose ? 'start' : null;
      if (!match) continue;
      const checkins = db.prepare('SELECT date, status, forgiven FROM checkins WHERE habit_id = ?').all(ch.id);
      const stats = computeStats(checkins, 0, 0, 0);
      const following = db
        .prepare('SELECT 1 AS one FROM community_follows WHERE follower_id = ? AND following_id = ?')
        .get(userId, cand.id);
      buddies.push({
        userId: cand.id,
        username: cand.username,
        habitName: ch.name,
        startDate: ch.start_date,
        daysDiff,
        match,
        streak: stats.currentStreak,
        following: !!following,
      });
    }
    const rank = { both: 0, habit: 1, start: 2 };
    buddies.sort((a, b) => rank[a.match] - rank[b.match]);
    return { optedIn, buddies };
  }

  app.get('/api/community/buddies', requireAuth, (req, res) => {
    res.json(buddyMatches(req.user.id));
  });

  app.put('/api/community/buddies', requireAuth, (req, res) => {
    const optedIn = !!req.body?.optedIn;
    db.prepare('UPDATE users SET buddy_opt_in = ? WHERE id = ?').run(optedIn ? 1 : 0, req.user.id);
    res.json({ optedIn });
  });
}
