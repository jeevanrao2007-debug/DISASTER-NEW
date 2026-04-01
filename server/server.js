import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fs from "fs";

/* Load service account */
const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json","utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors());
app.use(express.json());

let tokens = [];

/* Save browser token */
app.post("/register",(req,res)=>{
  const token = req.body.token;

  if(!tokens.includes(token))
      tokens.push(token);

  console.log("User registered:",token.substring(0,25)+"...");
  res.sendStatus(200);
});

/* Send notification */
app.post("/alert",async(req,res)=>{

  const {title,body} = req.body;

  const message={
    notification:{title,body},
    tokens:tokens
  };

  try{
    const r = await admin.messaging().sendEachForMulticast(message);
    console.log("Sent to",r.successCount,"devices");
    res.sendStatus(200);
  }catch(e){
    console.log(e);
    res.sendStatus(500);
  }
});

app.listen(3000,()=>console.log("Notification server running on 3000"));