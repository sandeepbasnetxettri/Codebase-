import React, { useState } from "react";
import { Alert, Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { formatNpr, request, Session, setAccessToken } from "./src/api";
type Tx = { id: string; direction: string; amountPaisa: string; description?: string; createdAt: string; counterparty?: { name: string; email: string } | null };
const notify = (message: string) => Platform.OS === "web" ? window.alert(message) : Alert.alert("Wallet Nepal", message);
export default function App() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const [transactions, setTransactions] = useState<Tx[]>([]); const [busy, setBusy] = useState(false); const [esewaAmount,setEsewaAmount]=useState(""); const [esewaTxn,setEsewaTxn]=useState("");
  const [qrAmount,setQrAmount]=useState(""); const [qrCode,setQrCode]=useState(""); const [payQrCode,setPayQrCode]=useState("");
  const [phone,setPhone]=useState(""); const [serviceAmount,setServiceAmount]=useState(""); const [billAmount,setBillAmount]=useState(""); const [customerRef,setCustomerRef]=useState("");
  const [kycName,setKycName]=useState(""); const [kycDob,setKycDob]=useState(""); const [kycDoc,setKycDoc]=useState(""); const [kycAddress,setKycAddress]=useState(""); const [adminSummary,setAdminSummary]=useState(""); const [adminKyc,setAdminKyc]=useState<any[]>([]); const [cashAmount,setCashAmount]=useState(""); const [cashOutAmount,setCashOutAmount]=useState(""); const [cashDestination,setCashDestination]=useState(""); const [adminCash,setAdminCash]=useState<any[]>([]); const [amlCases,setAmlCases]=useState<any[]>([]);
  async function loadTransactions() {
    const data = await request<{ transactions: Tx[] }>("/api/wallet/transactions");
    setTransactions(data.transactions);
  }
  async function authenticate() {
    setBusy(true);
    try {
      const data = await request<Session>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(mode === "register" ? { name, email, password } : { email, password }) });
      setAccessToken(data.accessToken); setSession(data); await loadTransactions();
    } catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  }
  async function action(path:string,body:any) { try { const result=await request<any>(path,{method:"POST",body:JSON.stringify(body)}); notify(result.message || result.status || "Demo request submitted"); return result; } catch(e) { notify((e as Error).message); return null; } }
  async function createQr(){ const r=await action("/api/services/qr/create",{amount:Number(qrAmount)}); if(r?.code)setQrCode(r.code); }
  async function payQr(){ const r=await action("/api/services/qr/pay",{code:payQrCode}); if(r)await loadTransactions(); }
  async function recharge(){ const r=await action("/api/services/recharge",{operator:"NTC",phone,amount:Number(serviceAmount)}); if(r)await loadTransactions(); }
  async function payBill(){ const r=await action("/api/services/bills",{category:"NEA_ELECTRICITY",customerRef,amount:Number(billAmount)}); if(r)await loadTransactions(); }
  async function submitKyc(){ await action("/api/services/kyc",{fullName:kycName,dateOfBirth:kycDob,documentType:"CITIZENSHIP",documentNumber:kycDoc,address:kycAddress}); }
  async function cashIn(){await action("/api/services/cash-in",{amount:Number(cashAmount),method:"BANK_TRANSFER"});}
  async function cashOut(){await action("/api/services/cash-out",{amount:Number(cashOutAmount),method:"BANK_TRANSFER",destination:cashDestination});}
  async function startEsewaPayment(){
    try {
      const result=await request<any>("/api/services/esewa/initiate",{method:"POST",body:JSON.stringify({amount:Number(esewaAmount)})});
      setEsewaTxn(result.transactionUuid);
      await Linking.openURL(`${API_URL}/api/services/esewa/checkout/${encodeURIComponent(result.transactionUuid)}`);
    } catch(e) { notify((e as Error).message); }
  }
  async function checkEsewaPayment(){
    if(!esewaTxn)return;
    try {
      const result=await request<any>(`/api/services/esewa/status/${encodeURIComponent(esewaTxn)}`);
      if(result.walletCredited){
        const wallet=await request<{balancePaisa:string;currency:string}>("/api/wallet");
        setSession(current=>current?{...current,user:{...current.user,wallet:{balancePaisa:wallet.balancePaisa,currency:wallet.currency}}}:current);
        await loadTransactions();
      }
      notify(result.walletCredited?"eSewa payment verified. Wallet balance updated.":`eSewa status: ${result.status}`);
    } catch(e) { notify((e as Error).message); }
  }
  async function loadAdmin(){ try { const r=await request<any>("/api/admin/overview"); const k=await request<any>("/api/admin/kyc"); const cash=await request<any>("/api/admin/cash-requests"); const aml=await request<any>("/api/admin/aml-cases"); setAdminSummary(`Users: ${r.users} · Pending KYC: ${r.pendingKyc} · Pending QR: ${r.pendingQrPayments}`); setAdminKyc(k.applications); setAdminCash(cash.requests); setAmlCases(aml.cases); } catch(e){notify((e as Error).message);} }
  async function reviewCash(id:string,status:"APPROVED"|"REJECTED"){try{await request(`/api/admin/cash-requests/${id}`,{method:"PATCH",body:JSON.stringify({status})});await loadAdmin();}catch(e){notify((e as Error).message);}}
  async function updateAml(id:string,status:"UNDER_REVIEW"|"CLEARED"|"ESCALATED"){try{await request(`/api/admin/aml-cases/${id}`,{method:"PATCH",body:JSON.stringify({status})});await loadAdmin();}catch(e){notify((e as Error).message);}}
  async function reviewKyc(id:string,status:"APPROVED"|"REJECTED"){ try { await request(`/api/admin/kyc/${id}`,{method:"PATCH",body:JSON.stringify({status})}); await loadAdmin(); } catch(e){notify((e as Error).message);} }
  async function sendTransfer() {
    const n = Number(amount);
    if (!recipientEmail || !Number.isFinite(n) || n <= 0) return notify("Enter recipient email and a valid amount.");
    const ok = Platform.OS === "web" ? window.confirm(`Send NPR ${n.toFixed(2)} in demo credits?`) : true;
    if (!ok) return;
    setBusy(true);
    try {
      await request("/api/wallet/transfers", { method: "POST", body: JSON.stringify({ recipientEmail, amount: n, note }) });
      const wallet = await request<{ balancePaisa: string; currency: string }>("/api/wallet");
      setSession(s => s ? { ...s, user: { ...s.user, wallet: { balancePaisa: wallet.balancePaisa, currency: wallet.currency } } } : s);
      setAmount(""); setNote(""); await loadTransactions(); notify("Demo transfer completed. No real money moved.");
    } catch (error) { notify((error as Error).message); } finally { setBusy(false); }
  }
  if (!session) return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.authWrap}>
    <View style={styles.brandRow}><Text style={styles.logo}>W</Text><Text style={styles.brand}>Wallet<Text style={styles.brandGreen}> Nepal</Text></Text></View>
    <Text style={styles.eyebrow}>INDEPENDENT WALLET DEMO</Text><Text style={styles.hero}>Your money,{"\n"}made simpler.</Text>
    <Text style={styles.sub}>A Nepal-focused wallet prototype. Demo credits only; no real payments.</Text>
    <View style={styles.card}><View style={styles.switchRow}>
      <TouchableOpacity onPress={() => setMode("login")} style={[styles.switch, mode === "login" && styles.switchActive]}><Text style={styles.switchText}>Sign in</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setMode("register")} style={[styles.switch, mode === "register" && styles.switchActive]}><Text style={styles.switchText}>Create account</Text></TouchableOpacity>
    </View>
    {mode === "register" && <Field label="Full name" value={name} onChangeText={setName} />}
    <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
    <Field label="Password (10+ characters)" value={password} onChangeText={setPassword} secureTextEntry />
    <TouchableOpacity disabled={busy} onPress={authenticate} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create wallet"}</Text></TouchableOpacity>
    </View><Text style={styles.disclaimer}>Not affiliated with eSewa. Do not use this prototype for real money or customer funds.</Text>
  </ScrollView></SafeAreaView>;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.dashboard}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>YOUR WALLET</Text><Text style={styles.heading}>Namaste, {session.user.name.split(" ")[0]}</Text></View>
      <TouchableOpacity onPress={() => { setAccessToken(""); setSession(null); }}><Text style={styles.signout}>Sign out</Text></TouchableOpacity></View>
    <View style={styles.balanceCard}><Text style={styles.balanceLabel}>Available demo balance</Text><Text style={styles.balance}>{formatNpr(session.user.wallet?.balancePaisa || "0")}</Text><Text style={styles.balanceLabel}>NPR · Test credits only</Text></View>
    <Text style={styles.sectionTitle}>Send demo money</Text><View style={styles.card}>
      <Field label="Recipient email" value={recipientEmail} onChangeText={setRecipientEmail} keyboardType="email-address" />
      <Field label="Amount (NPR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Note (optional)" value={note} onChangeText={setNote} />
      <TouchableOpacity disabled={busy} onPress={sendTransfer} style={styles.primary}><Text style={styles.primaryText}>{busy ? "Processing…" : "Send demo transfer"}</Text></TouchableOpacity>
    </View>

    <Text style={styles.sectionTitle}>Pay with eSewa</Text><View style={styles.card}><Field label="Payment amount (NPR)" value={esewaAmount} onChangeText={setEsewaAmount} keyboardType="decimal-pad"/><TouchableOpacity style={styles.primary} onPress={startEsewaPayment}><Text style={styles.primaryText}>Continue to eSewa</Text></TouchableOpacity>{esewaTxn ? <><Text style={styles.muted}>Transaction: {esewaTxn}</Text><TouchableOpacity style={styles.primary} onPress={checkEsewaPayment}><Text style={styles.primaryText}>Check eSewa payment status</Text></TouchableOpacity></> : null}<Text style={styles.muted}>Merchant checkout only. This does not top up your demo wallet.</Text></View>
    <Text style={styles.sectionTitle}>Cash in / cash out</Text><View style={styles.card}><Field label="Cash-in amount (NPR)" value={cashAmount} onChangeText={setCashAmount} keyboardType="decimal-pad"/><TouchableOpacity style={styles.primary} onPress={cashIn}><Text style={styles.primaryText}>Request cash-in</Text></TouchableOpacity><Field label="Cash-out amount (NPR)" value={cashOutAmount} onChangeText={setCashOutAmount} keyboardType="decimal-pad"/><Field label="Bank account / payout destination" value={cashDestination} onChangeText={setCashDestination}/><TouchableOpacity style={styles.primary} onPress={cashOut}><Text style={styles.primaryText}>Request cash-out</Text></TouchableOpacity><Text style={styles.muted}>Requests need admin approval. No real bank transfer or cash payout occurs.</Text></View>
    <Text style={styles.sectionTitle}>QR payments · Recharge · Bills · KYC</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Create a demo QR request</Text>
      <Field label="Amount (NPR)" value={qrAmount} onChangeText={setQrAmount} keyboardType="decimal-pad" />
      <TouchableOpacity style={styles.primary} onPress={createQr}><Text style={styles.primaryText}>Create QR code</Text></TouchableOpacity>
      {qrCode ? <Text style={styles.muted}>Share this demo code: {qrCode}</Text> : null}
      <Field label="Pay QR code" value={payQrCode} onChangeText={setPayQrCode} />
      <TouchableOpacity style={styles.primary} onPress={payQr}><Text style={styles.primaryText}>Pay demo QR</Text></TouchableOpacity>
    </View>
    <View style={styles.card}>
      <Text style={styles.label}>Mobile recharge (demo only)</Text>
      <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Amount (NPR)" value={serviceAmount} onChangeText={setServiceAmount} keyboardType="decimal-pad" />
      <TouchableOpacity style={styles.primary} onPress={recharge}><Text style={styles.primaryText}>Submit recharge demo</Text></TouchableOpacity>
    </View>
    <View style={styles.card}>
      <Text style={styles.label}>Bill payment (demo only)</Text>
      <Field label="Customer / meter reference" value={customerRef} onChangeText={setCustomerRef} />
      <Field label="Amount (NPR)" value={billAmount} onChangeText={setBillAmount} keyboardType="decimal-pad" />
      <TouchableOpacity style={styles.primary} onPress={payBill}><Text style={styles.primaryText}>Submit bill demo</Text></TouchableOpacity>
    </View>
    <View style={styles.card}>
      <Text style={styles.label}>KYC application (test data only)</Text>
      <Field label="Legal full name" value={kycName} onChangeText={setKycName} />
      <Field label="Date of birth (YYYY-MM-DD)" value={kycDob} onChangeText={setKycDob} />
      <Field label="Document number" value={kycDoc} onChangeText={setKycDoc} />
      <Field label="Address" value={kycAddress} onChangeText={setKycAddress} />
      <TouchableOpacity style={styles.primary} onPress={submitKyc}><Text style={styles.primaryText}>Submit demo KYC</Text></TouchableOpacity>
      <Text style={styles.muted}>Never enter real identity data in this prototype.</Text>
    </View>
    {session.user.role === "ADMIN" ? <View style={styles.card}><Text style={styles.sectionTitle}>Admin dashboard</Text><TouchableOpacity style={styles.primary} onPress={loadAdmin}><Text style={styles.primaryText}>Load admin overview</Text></TouchableOpacity>{adminSummary ? <Text style={styles.muted}>{adminSummary}</Text> : null}{adminCash.map(x=><View key={x.id} style={styles.txRow}><View style={{flex:1}}><Text style={styles.txTitle}>{x.type} · NPR {(Number(x.amountPaisa)/100).toFixed(2)}</Text><Text style={styles.muted}>{x.user?.email} · {x.status}</Text></View>{x.status==="PENDING"?<><TouchableOpacity onPress={()=>reviewCash(x.id,"APPROVED")}><Text style={styles.credit}>Approve</Text></TouchableOpacity><TouchableOpacity onPress={()=>reviewCash(x.id,"REJECTED")}><Text style={styles.debit}>Reject</Text></TouchableOpacity></>:null}</View>)}{amlCases.map(x=><View key={x.id} style={styles.txRow}><View style={{flex:1}}><Text style={styles.txTitle}>AML · {x.reason}</Text><Text style={styles.muted}>{x.user?.email} · {x.status} · {x.riskLevel}</Text></View><TouchableOpacity onPress={()=>updateAml(x.id,"UNDER_REVIEW")}><Text style={styles.credit}>Review</Text></TouchableOpacity><TouchableOpacity onPress={()=>updateAml(x.id,"ESCALATED")}><Text style={styles.debit}>Escalate</Text></TouchableOpacity></View>)}{adminKyc.map(k=><View key={k.id} style={styles.txRow}><View style={{flex:1}}><Text style={styles.txTitle}>{k.fullName} · {k.user.email}</Text><Text style={styles.muted}>{k.documentType} · {k.status}</Text></View>{k.status==="PENDING" ? <><TouchableOpacity onPress={()=>reviewKyc(k.id,"APPROVED")}><Text style={styles.credit}>Approve</Text></TouchableOpacity><TouchableOpacity onPress={()=>reviewKyc(k.id,"REJECTED")}><Text style={styles.debit}>Reject</Text></TouchableOpacity></> : null}</View>)}</View> : null}
    <Text style={styles.sectionTitle}>Recent transactions</Text><View style={styles.card}>
      {transactions.length === 0 ? <Text style={styles.muted}>No transactions yet.</Text> : transactions.map(tx => <View key={tx.id} style={styles.txRow}>
        <View style={styles.txIcon}><Text style={styles.txIconText}>{tx.direction === "CREDIT" ? "↓" : "↑"}</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.txTitle}>{tx.description || "Wallet transfer"}</Text><Text style={styles.muted}>{new Date(tx.createdAt).toLocaleString()}</Text></View>
        <Text style={[styles.txAmount, tx.direction === "CREDIT" ? styles.credit : styles.debit]}>{tx.direction === "CREDIT" ? "+" : "−"}{formatNpr(tx.amountPaisa)}</Text>
      </View>)}
    </View><Text style={styles.disclaimer}>QR, recharge, bills and cash operations remain demo-only. eSewa checkout records merchant payment status but does not add wallet balance.</Text>
  </ScrollView></SafeAreaView>;
}
function Field(props: any) { return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput {...props} autoCapitalize="none" placeholderTextColor="#9aa79f" style={styles.input} /></View>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f8f5" }, authWrap: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center", padding: 24, justifyContent: "center" },
  dashboard: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 20 }, brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 44 },
  logo: { backgroundColor: "#087d55", color: "white", overflow: "hidden", borderRadius: 10, paddingHorizontal: 11, paddingVertical: 6, fontWeight: "900", fontSize: 20 },
  brand: { fontSize: 21, fontWeight: "900", color: "#17251e" }, brandGreen: { color: "#087d55" }, eyebrow: { color: "#07865a", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  hero: { fontSize: 42, lineHeight: 48, fontWeight: "900", color: "#17251e", marginTop: 12 }, sub: { color: "#748279", lineHeight: 22, marginTop: 12, marginBottom: 24 },
  card: { backgroundColor: "white", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "#e7eee9", marginTop: 12 },
  switchRow: { flexDirection: "row", backgroundColor: "#f2f6f3", borderRadius: 10, padding: 4, marginBottom: 14 }, switch: { flex: 1, padding: 11, alignItems: "center", borderRadius: 8 }, switchActive: { backgroundColor: "white" }, switchText: { color: "#087d55", fontWeight: "700" },
  field: { marginBottom: 13 }, label: { color: "#526158", fontSize: 12, fontWeight: "700", marginBottom: 7 }, input: { borderWidth: 1, borderColor: "#e0e9e3", borderRadius: 9, padding: 13, fontSize: 15, color: "#17251e", backgroundColor: "#fcfdfc" },
  primary: { backgroundColor: "#087d55", padding: 15, borderRadius: 10, alignItems: "center", marginTop: 8 }, primaryText: { color: "white", fontWeight: "800" },
  disclaimer: { color: "#929e96", fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 22 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  heading: { color: "#17251e", fontSize: 25, fontWeight: "900", marginTop: 6 }, signout: { color: "#087d55", fontWeight: "700" },
  balanceCard: { backgroundColor: "#087d55", borderRadius: 18, padding: 24, marginBottom: 26 }, balanceLabel: { color: "#c9e8da", fontSize: 12 }, balance: { color: "white", fontSize: 34, fontWeight: "900", marginVertical: 8 },
  sectionTitle: { color: "#17251e", fontSize: 18, fontWeight: "900", marginTop: 14 }, muted: { color: "#8b9990", fontSize: 11 },
  txRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eef2ef", gap: 10 }, txIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#e6f5ed", alignItems: "center", justifyContent: "center" },
  txIconText: { color: "#087d55", fontWeight: "900" }, txTitle: { fontSize: 12, fontWeight: "700", color: "#27372e" }, txAmount: { fontSize: 11, fontWeight: "900" }, credit: { color: "#087d55" }, debit: { color: "#bd6558" }
});
