import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as mailer from "nodemailer";

admin.initializeApp();

const gmailEmail = functions.config().gmail.email;
const gmailPassword = functions.config().gmail.password;
const mailTransport = mailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailEmail,
    pass: gmailPassword,
  },
});

exports.sendEmailOnNewReservation = functions.firestore
  .document("users/{uid}/reservations/{documentId}")
  .onCreate(async (snap, context) => {
    const userRef = snap.ref.parent.parent;
    if (userRef === null) {
      return;
    }
    const userSnap = await userRef.get();
    const user = userSnap.data();
    if (user === undefined) return;
    const uid = userSnap.id;
    const link = `https://console.firebase.google.com/u/0/project/coach-flow/database/firestore/data~2Fusers~2F${uid}`;
    const mailOptions = {
      from: '"Coach Flow" <ramuniku@gmail.com>',
      to: "ramuniku@gmail.com",
      subject: "New reservation from coach flow.",
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
