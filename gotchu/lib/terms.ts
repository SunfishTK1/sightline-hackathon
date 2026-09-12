/**
 * @owner Will
 * Terms of Service shown, in full, before anyone can finish onboarding.
 * Bump TERMS_VERSION whenever the text changes materially - a stored
 * acceptance is only good for the version it was actually shown for.
 */
export const TERMS_VERSION = "2026-09-12";

export const TERMS_SECTIONS: Array<{ heading: string; body: string[] }> = [
  {
    heading: "1. Who can use Gotchu",
    body: [
      "Gotchu is available to Carnegie Mellon University students with a verified @andrew.cmu.edu email address who are at least 18 years old. By creating an account you confirm both of these are true, and that the information you submit during onboarding is accurate.",
    ],
  },
  {
    heading: "2. What Gotchu is",
    body: [
      "Gotchu connects students who need small tasks done (errands, pickups, food runs, and similar campus jobs) with other students willing to do them, and provides a personal AI agent, reachable by phone call and text message, to help submit, negotiate, and track those tasks on your behalf.",
      "Gotchu is a facilitator, not a party to the arrangement between a requester and a worker. We do not guarantee that any task will be completed, completed on time, or completed to a particular standard, and we are not responsible for the conduct of other users.",
    ],
  },
  {
    heading: "3. Your account",
    body: [
      "You are responsible for keeping your account information current and for anything that happens under your account. You may not create an account on behalf of someone else, or misrepresent your identity, year, or school affiliation.",
    ],
  },
  {
    heading: "4. Consent to calls and text messages",
    body: [
      "By checking the corresponding boxes during onboarding, you separately consent to receive phone calls and text messages from Gotchu and its automated agents at the number you provide, including calls and messages related to tasks, matching, negotiation, payments, and account activity. Message and data rates may apply. These consents are not a condition of using any unrelated service, and you may withdraw either one at any time by telling your agent to stop, though doing so may limit or end your ability to use Gotchu, since the service is built around calling and texting.",
    ],
  },
  {
    heading: "5. Your content and data",
    body: [
      "“Your content” means anything you submit to Gotchu or say to your agent - profile details, task descriptions, photos, and the substance of your calls and text conversations with our agents.",
      "You grant Gotchu a non-exclusive, worldwide, royalty-free license to host, process, reproduce, and analyze your content in order to operate, maintain, and improve the service. This includes using the content of your interactions with our agents - what you ask for, how you phrase it, and how you respond - to train, fine-tune, and evaluate the models and personalization features that power Gotchu's agents, and to build profiles used to adapt how an agent communicates with you. You can ask us to stop using your data for this purpose by contacting us as described in Section 12, though this will not undo any training already completed before your request.",
      "We do not sell your content to third parties. We may share it with service providers who help us operate Gotchu (for example, hosting, messaging, and model providers), bound by obligations to protect it.",
    ],
  },
  {
    heading: "6. Payments and marketplace conduct",
    body: [
      "Prices agreed between a requester and a worker are between those two users. Gotchu may facilitate payment processing but does not set task prices, guarantee funds, or arbitrate disputes over the quality or completion of a task, beyond the completion-confirmation flow built into the app.",
      "You agree not to use Gotchu for anything illegal, for tasks that violate CMU policy (including academic integrity - Gotchu will not knowingly facilitate having someone else complete graded coursework), or for anything that would require another person to misrepresent their identity or credentials to complete it.",
    ],
  },
  {
    heading: "7. AI agents",
    body: [
      "Gotchu's agents are automated and can make mistakes, misunderstand requests, or act on incomplete information. You should not rely on an agent's output for anything where an error would cause serious harm, and you remain responsible for reviewing what your agent submits, agrees to, or confirms on your behalf.",
    ],
  },
  {
    heading: "8. Suspension and termination",
    body: [
      "We may suspend or terminate your access to Gotchu at any time, with or without notice, for conduct we reasonably believe violates these Terms, harms other users, or exposes Gotchu to legal or safety risk. You may stop using Gotchu and request account deletion at any time.",
    ],
  },
  {
    heading: "9. Disclaimers",
    body: [
      "Gotchu is provided “as is” and “as available,” without warranties of any kind, express or implied, including fitness for a particular purpose, non-infringement, or that the service will be uninterrupted, secure, or error-free.",
    ],
  },
  {
    heading: "10. Limitation of liability",
    body: [
      "To the maximum extent permitted by law, Gotchu and its team are not liable for indirect, incidental, special, or consequential damages arising from your use of the service, or for the acts or omissions of other users, including a task that goes undone, is done poorly, or is disputed.",
    ],
  },
  {
    heading: "11. Changes to these Terms",
    body: [
      "We may update these Terms from time to time. If we make a material change, we will ask you to accept the new version before you can continue using Gotchu. Continuing to use Gotchu after a non-material update constitutes acceptance of the update.",
    ],
  },
  {
    heading: "12. Contact",
    body: [
      "Questions about these Terms, or requests regarding how your data is used, can be sent to the Gotchu team through the contact channel listed in the app.",
    ],
  },
];
