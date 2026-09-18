// ============================================
// SURE — shared comment helpers
// ============================================
import { db, ref, set, remove } from "./firebase.js";
import { pushItem, updateItem, PATH } from "./database.js";

export async function postComment({ threadId, user, text }){
  if(!user) throw new Error("Sign in required");
  if(user.status === "suspended") throw new Error("Account suspended");
  if(user.canComment === false) throw new Error("Commenting privilege suspended");
  const clean = String(text||"").trim();
  if(!clean) throw new Error("Empty comment");
  if(clean.length > 800) throw new Error("Comment too long");

  return pushItem(PATH.comments, {
    threadId,
    uid: user.uid,
    userName: user.name,
    role: user.role || "user",
    text: clean,
    likes: 0,
    hidden: false,
    createdAt: Date.now()
  });
}

export async function replyTo({ threadId, parentId, user, text }){
  if(!user) throw new Error("Sign in required");
  const clean = String(text||"").trim();
  if(!clean) throw new Error("Empty reply");
  return pushItem(PATH.comments, {
    threadId,
    parentId,
    uid: user.uid,
    userName: user.name,
    role: user.role || "user",
    text: clean,
    likes: 0,
    hidden: false,
    createdAt: Date.now()
  });
}

export async function likeComment(id, current){
  return updateItem(PATH.comments, id, { likes: (current||0) + 1 });
}

export async function reportComment({ commentId, threadId, user, reason="" }){
  return pushItem("reports", {
    commentId, threadId,
    reportedBy: user?.uid || null,
    reason,
    status: "OPEN",
    createdAt: Date.now()
  });
}

export async function hideComment(id, hidden){
  return updateItem(PATH.comments, id, { hidden: !!hidden });
}

export async function deleteComment(id){
  // RTDB delete = set null
  return set(ref(db, `${PATH.comments}/${id}`), null);
}

export async function setThreadLock(threadId, locked){
  return set(ref(db, `threadLocks/${threadId}`), !!locked);
}

export async function toggleCommenting(uid, allowed){
  return updateItem(PATH.users, uid, { canComment: !!allowed });
}