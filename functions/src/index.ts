import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as mailer from "nodemailer";
import { google } from "googleapis";
import * as moment from "moment";
import "moment-timezone/index";
admin.initializeApp();

const firestore = admin.firestore();

const gmailEmail = functions.config().gmail.email;
const gmailPassword = functions.config().gmail.password;
const mailTransport = mailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailEmail,
    pass: gmailPassword,
  },
});
const credentials = {
  client_secret: functions.config().google.client_secret,
  client_id:
    "1004250290138-06vgt2elldor0fqo5bf4sj3bjkhrpi8t.apps.googleusercontent.com",
  redirect_uri: "https://coach-flow.firebaseapp.com/__/auth/handler",
};

exports.sendEmailOnNewReservation = functions.firestore
  .document("users/{uid}/reservations/{documentId}")
  .onCreate(async (snap, context) => {
    const userRef = snap.ref.parent.parent;
    if (userRef === null) return;
    const userSnap = await userRef.get();
    const user = userSnap.data();
    if (user === undefined) return;
    const uid = userSnap.id;
    const link = `https://console.firebase.google.com/u/0/project/coach-flow/firestore/data~2Fusers~2F${uid}`;
    const mailOptions = {
      from: `"村上僚" <${gmailEmail}>`,
      to: gmailEmail,
      subject: "相談/コーチングの予約を受け付けました",
      text: `${JSON.stringify(user, null, 1)}\n${uid}\n${link}`,
    };
    try {
      await mailTransport.sendMail(mailOptions);
      functions.logger.log("Mail sent", context.params.documentId);
    } catch (error) {
      console.error("There was an error while sending the email:", error);
    }
    return null;
  });

exports.calendarTest = functions.https.onRequest((req, resp) => {
  try {
    authorize(credentials, getEvents);
  } catch (e) {
    console.error(e);
  }

  async function getEvents(auth: any) {
    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 20,
      q: "Calendly.com",
      singleEvents: true,
      orderBy: "startTime",
    });
    if (response.data.items === undefined) return;
    const events = response.data.items;
    console.log(events);
    resp.status(200).json({
      events: events.map((event) => {
        if (event.start === undefined) return undefined;
        return moment(event.start.dateTime)
          .tz("Asia/Tokyo")
          .format("YYYY-MM-DD hh:mm");
      }),
    });
    return;
  }
});

exports.sendReminderMail = functions.pubsub
  .schedule("every 12 hours")
  .onRun(() => {
    try {
      authorize(credentials, remindEvent);
    } catch (e) {
      console.error(e);
    }
  });

function authorize(
  credentials: {
    client_secret: string;
    client_id: string;
    redirect_uri: string;
  },
  callback: {
    (auth: any): Promise<void>;
    (arg0: import("googleapis-common").OAuth2Client): void;
  }
) {
  const { client_secret, client_id, redirect_uri } = credentials;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uri
  );
  const accessToken = {
    access_token: functions.config().google.access_token,
    refresh_token: functions.config().google.refresh_token,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    token_type: "Bearer",
    expiry_date: 1598096466225,
  };
  oAuth2Client.setCredentials(accessToken);
  callback(oAuth2Client).then(() => {});
}

async function remindEvent(auth: any) {
  const calendar = google.calendar({ version: "v3", auth });
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 20,
    q: "Calendly.com",
    singleEvents: true,
    orderBy: "startTime",
  });

  if (response.data.items === undefined) return;
  const events = response.data.items.filter((event) => {
    if (event.attendees === undefined) return;
    if (event.start === undefined) return;
    console.log(moment(event.start.dateTime).fromNow());
    const accepted = event.attendees[0].responseStatus === "accepted";
    const now = moment();
    const in6hours =
      moment.duration(now.diff(moment(event.start.dateTime))).hours() < 12;
    return accepted && in6hours;
  });
  if (!events || events.length === 0) {
    console.error("no event");
  }
  try {
    events.forEach((event) => {
      if (event.attendees === undefined) return;
      if (!event.attendees[1]) return;
      if (event.start === undefined) return;
      firestore
        .collection("users")
        .where("email", "==", event.attendees[1].email)
        .get()
        .then((snapshot) => {
          if (snapshot.empty) {
            if (event.attendees === undefined) return;
            console.log(`No matching user for ${event.attendees[1]}`);
            return;
          }
          snapshot.forEach((doc) => {
            console.log(doc.id, "=>", doc.data());
            const user = doc.data();
            const link = `https://console.firebase.google.com/u/0/project/coach-flow/firestore/data~2Fusers~2F${doc.id}`;

            const mailOptionsForMyself = {
              from: `"俺自身" <${gmailEmail}>`,
              to: gmailEmail,
              subject: "相談のリマインダー",
              text: `${JSON.stringify(user, null, 1)}\n${doc.id}\n${link}`,
            };
            if (event.start === undefined) return;
            const time = moment(event.start.dateTime)
              .tz("Asia/Tokyo")
              .format("YYYY-MM-DD hh:mm");
            console.log(event.start.dateTime);
            console.log(time);
            const mailOptionsForClient = {
              from: `"村上僚" <${gmailEmail}>`,
              to: user.email,
              subject: "相談/コーチングのリマインダーです",
              text: `${user.displayNameInApp}さん\n\nご予約の時刻が近づいておりますので、リマインドをお送りしました。\nお会いできることを楽しみにしております。\n\n日時 ： ${time}\n\n場所 ： ${event.hangoutLink}\n\n事前質問への回答をご確認される場合、以下をご確認ください。\nhttps://ryo-murakami.now.sh/my-page`,
            };
            mailTransport.sendMail(mailOptionsForMyself);
            functions.logger.log("Reminder Mail sent to myself.");
            mailTransport.sendMail(mailOptionsForClient);
            functions.logger.log("Reminder Mail sent to client.");
          });
        });
    });
  } catch (error) {
    console.error("There was an error while sending the email:", error);
    return;
  }
  return;
}
