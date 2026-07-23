# Clarity — Unified Workspace for Tasks and Projects

## Project Proposal

**Course Instructor:** Sir Zeeshan Nazar

**Group Members:**

| Name | Roll Number |
|------|-------------|
| Mohammad Hamza Iqbal | 23L-0848 |
| Bilal Kashif | 23L-0757 |
| Mawahid Abbas | 23L-0613 |

**National University of Computer and Emerging Sciences**
Department of Computer Science
Lahore, Pakistan

---

## Abstract

Clarity is an all-in-one productivity application designed for web and mobile that unifies task management, scheduling, collaboration, and communication into a single platform. Built using Angular, Ionic, and Capacitor with real-time synchronization through Socket.IO, it offers an intuitive drag-and-drop interface, collaborative editing, and seamless integration with third-party services such as Gmail, Google Calendar, and Google Contacts. By incorporating AI-powered automation and insights, Clarity enhances productivity through intelligent scheduling, reminders, and progress analytics, while its unified environment reduces the inefficiencies caused by switching between multiple applications.

## Introduction

Apps that we use today have many tools in them. We use a notes app for our to-do lists, documents for our papers, and calendars for reminders. However, there is not a single app that incorporates everything in it. Productivity means juggling many things like multitasking, keeping track of progress, collaborating with peers, and much more. Switching between apps and organizing has become complex.

Clarity is an all-in-one mobile and web app that brings these features together to create ease for users, especially students. At its core, Clarity offers a drag-and-drop based interface for intuitive task and project organization, with support for interconnected task threads that adapt dynamically as work progresses. It also supports collaborative editing, direct task-level communication, and third-party integrations such as Gmail, Google Calendar and Google Contacts to make teamwork smoother and more efficient.

What sets Clarity apart is its intelligent automation and AI-powered insights. By unifying everything in one coherent app, it makes doing tasks simpler and more engaging while creating an environment that supports learning and productivity.

## Goals and Objectives

Our project's objectives include:

- Developing an all-in-one productivity application for web and mobile that combines task management, scheduling, collaboration, and communication.
- Providing an intuitive drag-and-drop interface with support for interconnected task threads that adapt dynamically as work progresses.
- Enabling real-time collaborative editing to improve teamwork efficiency.
- Integrating third-party services such as Gmail, Google Calendar and Google Contacts to streamline workflows.
- Implementing AI-powered automation for reminders, intelligent scheduling, and productivity insights.
- Offering personalized yet coherent workspace layouts through a semi-grid interface to enhance usability.
- Providing analytics, graphs, and visualizations to track productivity and progress effectively.

## Scope of the Project

Our project mainly focuses on developing an all-in-one productivity application for web and mobile that integrates task management, collaboration, scheduling, and automation into a single platform. The system will be built using Angular for both the backend and frontend, with Ionic and Capacitor to ensure cross-platform compatibility on web and mobile devices.

For real-time collaboration, Socket.IO will be used to synchronize updates between users, enabling multiple participants to work on shared projects simultaneously. Since offline syncing is not required, the system will operate with live data only. Third-party APIs such as Google Calendar, Google Contacts, and Gmail will be supported, with integration remaining optional for each user depending on their needs. User activity and project data will initially be stored in structured JSON objects within the application, reducing the need for a dedicated database at this stage.

Artificial Intelligence will form a key part of the system. The AI module will analyze task history to identify productivity bottlenecks, highlight areas for improvement, and generate insights for better workflow management. An AI agent will also be available to handle routine actions such as sending invites and scheduling tasks or events directly into integrated calendars.

For analytics and visualizations, lightweight solutions such as Chart.js or Recharts will be adopted to display task completion rates, productivity trends, and progress summaries in a clear and interactive manner.

The project will not include a dedicated database in its initial implementation, as all user activity and project data will be managed through structured JSON objects within the application. Furthermore, offline synchronization will not be supported, since the system is designed to operate exclusively with live data in real time.

## Initial Study and Work Done So Far

As far as our research is concerned, many tools already exist to manage productivity, tasks, collaboration, and scheduling. Applications such as Trello, Notion, and Asana focus on tasks and project organization; Gmail and Google Contacts focus on communication; and Google Calendar manages scheduling. However, no single tool brings all of these together in one place, forcing users to switch between multiple platforms to accomplish different parts of their work.

Studies show that switching between apps wastes significant time and reduces productivity. A Harvard Business Review report found that employees lose hours each week regaining focus after toggling between tools, which contributes to mental fatigue and lower efficiency [1].

Other research highlights that fragmented application environments, where different apps do not integrate or synchronize properly, cause delays, misunderstandings, and additional effort in teamwork [2]. Furthermore, real-time collaboration has been identified as a critical factor for improving productivity and reducing communication overhead in digital teamwork [3].

Our aim is to integrate these fragmented features like task management, scheduling, communication, collaboration, and analytics into one web and mobile application. So far, we have reviewed existing productivity platforms, explored real-time synchronization technologies such as Socket.IO, and identified relevant third-party APIs (Google Calendar, Gmail, Google Contacts). These findings will guide our system architecture and feature set for Clarity.

## References

[1] A. Waber, "How much time and energy do we waste toggling between applications?," *Harvard Business Review*, Aug. 2022. [Online]. Available: https://hbr.org/2022/08/how-much-time-and-energy-do-we-waste-toggling-between-applications

[2] M. S. González et al., "Tools for Online Collaboration: Do they contribute to Improve Teamwork?," *Revista Facultad de Ingeniería Universidad de Antioquia*, no. 77, pp. 23–32, 2015. [Online]. Available: https://www.researchgate.net/publication/287157555_Tools_for_Online_Collaboration_Do_they_contribute_to_Improve_Teamwork

[3] "Real-time collaboration: What it is and why it matters," *ProofHub*, 2023. [Online]. Available: https://www.proofhub.com/articles/real-time-collaboration

---

**Group Members:**

| Name | Roll Number |
|------|-------------|
| Mohammad Hamza Iqbal | 23L-0848 |
| Bilal Kashif | 23L-0757 |
| Mawahid Abbas | 23L-0613 |
