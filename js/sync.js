// js/sync.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://dtrqapdwautfchkdxcjm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MGvraq_UcNWcxb1euk5fyw_ekOl_k6y";
const SUPABASE_TABLE = "bp_logs";

export function makeSupabase(){
  try{
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }catch{
    return null;
  }
}

export async function encryptObjectToPayload(obj, pin, logId){
  const saltStr = `bp:${logId}:v4`;
  const key = await deriveKey(pin, saltStr);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const plain = enc.encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, plain);
  const cipher = new Uint8Array(cipherBuf);
  return "v4." + b64FromBytes(iv) + "." + b64FromBytes(cipher);
}

export async function decryptPayloadToObject(payload, pin, logId){
  const parts = String(payload||"").split(".");
  if(parts.length !== 3) throw new Error("payload formátum hibás");
  const ver = parts[0]; // v4
  const iv = bytesFromB64(parts[1]);
  const cipher = bytesFromB64(parts[2]);
  const saltStr = `bp:${logId}:${ver}`;
  const key = await deriveKey(pin, saltStr);
  const plainBuf = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, cipher);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

export async function cloudPull(sb, logId, pin){
  const { data, error } = await sb
    .from(SUPABASE_TABLE)
    .select("id, updated_at, payload")
    .eq("id", logId)
    .maybeSingle();
  if(error) throw error;
  if(!data) return { exists:false, updated_at:null, obj:null };
  const obj = await decryptPayloadToObject(data.payload, pin, logId);
  return { exists:true, updated_at:data.updated_at, obj };
}

export async function cloudPush(sb, logId, pin, obj){
  const payload = await encryptObjectToPayload(obj, pin, logId);
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from(SUPABASE_TABLE)
    .upsert({ id: logId, payload, updated_at: nowIso }, { onConflict: "id" });
  if(error) throw error;
  return { updated_at: nowIso };
}

/* helpers */
async function deriveKey(pin, saltStr){
  const enc = new TextEncoder();
  const salt = enc.encode(saltStr);
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), { name:"PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:120000, hash:"SHA-256" },
    baseKey,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt","decrypt"]
  );
}
function b64FromBytes(bytes){
  let s=""; bytes.forEach(b=> s += String.fromCharCode(b));
  return btoa(s);
}
function bytesFromB64(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
