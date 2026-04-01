/* ================= IMPORTS ================= */

import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { app } from "./src/config/firebase.js";

/* ================= FIREBASE ================= */

const db = getDatabase(app);

/* ================= DUPLICATE CHECK ================= */

async function exists(id){
  const snap = await get(child(ref(db), "pending/"+id));
  return snap.exists();
}

/* ================= EARTHQUAKE DETECTOR ================= */

async function detectEarthquake(){
  try{
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson");
    const data = await res.json();

    for(const eq of data.features){

      const mag = eq.properties.mag || 0;
      if(mag < 4.5) continue;

      const place = eq.properties.place;
      const time = eq.properties.time;
      const lat = eq.geometry.coordinates[1];
      const lng = eq.geometry.coordinates[0];

      const id = "eq_"+time;
      if(await exists(id)) continue;

      let level="Moderate";
      if(mag>=5.5) level="High";
      if(mag>=6.5) level="Critical";

      await set(ref(db,"pending/"+id),{
        type:"Earthquake",
        level,
        desc:`Magnitude ${mag} near ${place}`,
        lat,lng,
        source:"USGS Seismic Feed",
        confidence: Math.min(99,Math.floor(mag*15)),
        detectedAt:new Date().toLocaleString(),
        auto:true
      });

      console.log("Earthquake stored:",place);
    }

  }catch(e){
    console.log("Earthquake detection error",e);
  }
}

/* ================= FLOOD DETECTOR ================= */

async function detectFlood(){
  try{
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=13.08&longitude=80.27&hourly=rain");
    const data = await res.json();

    const rain = data?.hourly?.rain ? Math.max(...data.hourly.rain) : 0;
    if(rain < 40) return;

    const id="flood_"+Math.floor(Date.now()/3600000);
    if(await exists(id)) return;

    let level="Moderate";
    if(rain>70) level="High";
    if(rain>110) level="Critical";

    await set(ref(db,"pending/"+id),{
      type:"Flood Risk",
      level,
      desc:`Rainfall intensity ${rain} mm/hr`,
      lat:13.08,lng:80.27,
      source:"Weather Precipitation Model",
      confidence:Math.min(95,Math.floor(rain)),
      detectedAt:new Date().toLocaleString(),
      auto:true
    });

    console.log("Flood risk stored");

  }catch(e){
    console.log("Flood detection error",e);
  }
}

/* ================= FIRE RISK DETECTOR ================= */

async function detectFire(){
  try{
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=13.08&longitude=80.27&current_weather=true");
    const data = await res.json();

    const temp = data?.current_weather?.temperature ?? 0;
    if(temp < 38) return;

    const id="fire_"+Math.floor(Date.now()/3600000);
    if(await exists(id)) return;

    let level="Moderate";
    if(temp>42) level="High";
    if(temp>46) level="Critical";

    await set(ref(db,"pending/"+id),{
      type:"Fire Risk",
      level,
      desc:`Surface temperature ${temp}°C`,
      lat:13.08,lng:80.27,
      source:"Thermal Weather Model",
      confidence:Math.min(96,Math.floor(temp*2)),
      detectedAt:new Date().toLocaleString(),
      auto:true
    });

    console.log("Fire risk stored");

  }catch(e){
    console.log("Fire detection error",e);
  }
}

/* ================= CYCLONE DETECTOR ================= */

async function detectCyclone(){
  try{
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=13.08&longitude=80.27&hourly=windspeed_10m");
    const data = await res.json();

    const wind = data?.hourly?.windspeed_10m ? Math.max(...data.hourly.windspeed_10m) : 0;
    if(wind < 50) return;

    const id="wind_"+Math.floor(Date.now()/3600000);
    if(await exists(id)) return;

    let level="Moderate";
    if(wind>75) level="High";
    if(wind>100) level="Critical";

    await set(ref(db,"pending/"+id),{
      type:"Cyclone Risk",
      level,
      desc:`Wind speed ${wind} km/h`,
      lat:13.08,lng:80.27,
      source:"Atmospheric Wind Model",
      confidence:Math.min(98,Math.floor(wind)),
      detectedAt:new Date().toLocaleString(),
      auto:true
    });

    console.log("Cyclone risk stored");

  }catch(e){
    console.log("Cyclone detection error",e);
  }
}

/* ================= MASTER LOOP ================= */

async function run(){
  detectEarthquake();
  detectFlood();
  detectFire();
  detectCyclone();
}

/* run every 60 seconds */
setInterval(run,60000);

/* run immediately once */
run();

console.log("Real-world disaster detection engine running");