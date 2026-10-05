import 'react-native-url-polyfill/auto';
import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, TextInput, ScrollView, Alert, AppState, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { createClient } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

// Same Supabase project as the web shop
const sb = createClient('https://jsjwitaivrrjnhczucwb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzandpdGFpdnJyam5oY3p1Y3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NjIyNDAsImV4cCI6MjEwNjUzODI0MH0.GY6R303fXU-Fmn9eQjUP69nCF91oF63ASX0FYcNAAG0',
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' } });

const naira = n => '₦' + Number(n).toLocaleString();
const C = { hib: '#6B1535', leaf: '#2F5D3A', sun: '#F2B632', chalk: '#FBF6F4', ink: '#2A1A20', line: '#E8D9D6' };

async function login() {
  const redirectTo = Linking.createURL('auth');
  const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error) return Alert.alert('Sign-in error', error.message);
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type === 'success') {
    const code = /[?&]code=([^&#]+)/.exec(res.url)?.[1];
    if (code) {
      const { error: e } = await sb.auth.exchangeCodeForSession(decodeURIComponent(code));
      if (e) Alert.alert('Sign-in error', e.message);
    }
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('shop');
  const [form, setForm] = useState({ name: '', phone: '', addr: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    sb.from('products').select('*').eq('in_stock', true).order('id').then(({ data }) => setProducts(data || []));
    return () => subscription.unsubscribe();
  }, []);

  const loadCart = useCallback(async () => {
    const { data } = await sb.from('cart_items').select('product_id,qty');
    const c = {}; (data || []).forEach(r => { c[r.product_id] = r.qty; }); setCart(c);
  }, []);
  const loadOrders = useCallback(async () => {
    const { data } = await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    setOrders(data || []);
  }, []);

  useEffect(() => {
    if (!user) { setCart({}); setOrders([]); return; }
    loadCart(); loadOrders();
    const ch = sb.channel('cart-mobile').on('postgres_changes', { event: '*', schema: 'public', table: 'cart_items' }, loadCart).subscribe();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') loadCart(); });
    return () => { sb.removeChannel(ch); sub.remove(); };
  }, [user]);

  const change = async (id, d) => {
    const q = (cart[id] || 0) + d;
    setCart(c => { const n = { ...c }; if (q < 1) delete n[id]; else n[id] = q; return n; });
    if (q < 1) await sb.from('cart_items').delete().eq('product_id', id);
    else await sb.from('cart_items').upsert({ user_id: user.id, product_id: id, qty: q });
  };

  const total = Object.entries(cart).reduce((t, [id, q]) => t + (products.find(p => p.id == id)?.price || 0) * q, 0);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  const place = async () => {
    if (!form.name.trim() || !form.addr.trim()) return setMsg('Enter your name and address.');
    setBusy(true); setMsg('');
    const items = Object.entries(cart).map(([id, qty]) => ({ id: +id, qty }));
    const { data, error } = await sb.rpc('place_order', { p_items: items, p_name: form.name.trim(), p_phone: form.phone.trim() || 'not provided', p_address: form.addr.trim() });
    if (error) { setBusy(false); return setMsg('Order failed: ' + error.message); }
    await sb.from('cart_items').delete().eq('user_id', user.id);
    setCart({}); setBusy(false); setForm({ name: '', phone: '', addr: '' });
    loadOrders(); setTab('orders'); Alert.alert('Order placed', 'Order #' + data.slice(0, 8) + ' is in.');
  };

  if (!ready) return <View style={[s.center, { backgroundColor: C.hib }]}><ActivityIndicator color="#fff" /></View>;

  if (!user) return (
    <SafeAreaProvider><View style={[s.center, { backgroundColor: C.hib, padding: 28 }]}>
      <Text style={s.hero}>Zobo cold. Chin chin crunchy.</Text>
      <Text style={{ color: '#fff', marginVertical: 16, fontSize: 16 }}>Sign in to shop. Your cart follows you between phone and web.</Text>
      <Pressable style={s.btn} onPress={login}><Text style={s.btnT}>Sign in with Google</Text></Pressable>
    </View></SafeAreaProvider>
  );

  return (
    <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: C.chalk }}>
      <View style={s.head}>
        <Text style={s.brand}>Mama Ngozi's</Text>
        <Pressable onPress={() => sb.auth.signOut()}><Text style={{ color: '#fff' }}>Log out</Text></Pressable>
      </View>

      {tab === 'shop' && <FlatList data={products} keyExtractor={p => String(p.id)} contentContainerStyle={{ padding: 14, gap: 12 }}
        renderItem={({ item: p }) => (
          <View style={s.card}>
            <Text style={{ fontSize: 34 }}>{p.emoji}</Text>
            <Text style={s.h3}>{p.name}</Text>
            <Text>{p.description}</Text>
            <Text style={s.price}>{naira(p.price)}</Text>
            <Pressable style={s.btn} onPress={() => change(p.id, 1)}><Text style={s.btnT}>Add to cart{cart[p.id] ? ` (${cart[p.id]})` : ''}</Text></Pressable>
          </View>)} />}

      {tab === 'cart' && <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
        {count === 0 ? <Text style={s.h3}>Your cart is empty</Text> : <>
          {Object.keys(cart).map(id => { const p = products.find(x => x.id == id); if (!p) return null; return (
            <View key={id} style={s.row}>
              <Text style={{ flex: 1 }}>{p.emoji} {p.name}</Text>
              <Pressable style={s.qb} onPress={() => change(+id, -1)}><Text>−</Text></Pressable>
              <Text style={{ marginHorizontal: 8 }}>{cart[id]}</Text>
              <Pressable style={s.qb} onPress={() => change(+id, 1)}><Text>+</Text></Pressable>
              <Text style={{ width: 80, textAlign: 'right', fontWeight: '600' }}>{naira(p.price * cart[id])}</Text>
            </View>); })}
          <Text style={[s.h3, { marginVertical: 12 }]}>Total {naira(total)}</Text>
          <TextInput style={s.in} placeholder="Full name" value={form.name} onChangeText={v => setForm({ ...form, name: v })} />
          <TextInput style={s.in} placeholder="Phone (optional)" keyboardType="phone-pad" value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} />
          <TextInput style={[s.in, { height: 80 }]} multiline placeholder="Delivery address" value={form.addr} onChangeText={v => setForm({ ...form, addr: v })} />
          {!!msg && <Text style={{ color: '#b00020', marginBottom: 8 }}>{msg}</Text>}
          <Pressable style={[s.btn, { backgroundColor: C.leaf }]} disabled={busy} onPress={place}><Text style={[s.btnT, { color: '#fff' }]}>{busy ? 'Placing…' : 'Place order (pay on delivery)'}</Text></Pressable>
        </>}
      </ScrollView>}

      {tab === 'orders' && <FlatList data={orders} keyExtractor={o => o.id} contentContainerStyle={{ padding: 14, gap: 12 }}
        ListEmptyComponent={<Text style={s.h3}>No orders yet</Text>}
        renderItem={({ item: o }) => (
          <View style={s.card}>
            <Text style={s.h3}>#{o.id.slice(0, 8)} · {o.status}</Text>
            <Text>{new Date(o.created_at).toLocaleString()}</Text>
            {o.order_items.map(i => <Text key={i.id}>{i.qty} × {i.name} — {naira(i.qty * i.unit_price)}</Text>)}
            <Text style={s.price}>Total {naira(o.total)}</Text>
          </View>)} />}

      <View style={s.tabs}>
        {[['shop', 'Shop'], ['cart', `Cart (${count})`], ['orders', 'Orders']].map(([k, l]) => (
          <Pressable key={k} style={[s.tab, tab === k && { borderTopColor: C.hib }]} onPress={() => { setTab(k); if (k === 'orders') loadOrders(); if (k === 'cart') loadCart(); }}>
            <Text style={{ fontWeight: tab === k ? '700' : '400', color: C.ink }}>{l}</Text>
          </Pressable>))}
      </View>
    </SafeAreaView></SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  hero: { color: '#fff', fontSize: 38, fontWeight: '800', lineHeight: 42 },
  head: { backgroundColor: C.hib, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: '#fff', fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: '#fff', borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 16, gap: 4 },
  h3: { fontSize: 18, fontWeight: '700', color: C.ink },
  price: { color: C.leaf, fontWeight: '700', marginVertical: 4 },
  btn: { backgroundColor: C.sun, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnT: { fontWeight: '700', color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
  qb: { backgroundColor: C.line, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  in: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, marginBottom: 10 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', padding: 14, borderTopWidth: 3, borderTopColor: 'transparent' },
});
