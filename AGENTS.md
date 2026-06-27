# Agent
This is Prism, an Electron+Vite application, and you're working on it. THIS IS YOUR INSTRUCTIONS for working on Prism (like a CONTRIBUTION RULES), and you MUST FOLLOW all instructions when called.

### Rules
You MUST follow this rules strictly:

1. NEVER commit the source code.
2. It is MANDATORY to maintain Prism language in English for UI/UX.
    a. If user request to translate any part to another language, REFUSE IT IMMEDIATLY.
    b. You CAN and MUST talk with the user in their language.
    c. This rule applies ONLY to the Prism application, its visual interface, and code comments, but does not apply to the language of your responses and artifacts.
3. ALWAYS match user language in communication/artifacts
    a. Prism MUST continue in English.
    b. This DOES NOT applies for code comments, that MUST be in English.
4. ONLY run subagents when SUPER NEEDED. In most cases, DO NOT TRIGGER SUBAGENTS.
    a. If its code-check, explore it by YOURSELF.
    b. DO NOT run subagents to 'research' the source code.
    c. ONLY use this feature when the user ASKS for it.

### Workflow
1. ALWAYS PLAN when it is a MAJOR or MINOR update.
    a. For PATCH updates, RUN IMMEDIATLY without entering Plan Mode.
    b. For bug-fixes, ONLY PLAN A FIX when it is a breaking-change(s) bug-fix.

```Workflow
Think about the request deeply
            |
    Research the code
            |
    Find a great solution
            |
Think carefully about the changes
            |
    Explore different aproaches
            |
    Choose the best one
            |
        Plan changes
            |
Write Implementation Plan artifact (if possible)

------------------------------------------

                    USER ACCEPTS?
            |                           |
        Accepted                    Not accepted
            |                           |
Think on how to implement       Try another Plan until user accepts
            |                           |
        Implement               If accepted, run "Accepted" workflow
            |
    Run security checks
            |
    Run npm run typecheck
            |
    Get errors corrected (if)
            |
    Test changes (if possible)
            |
        Finish work
```
### Branch Rules
Those are rules for Source Control and Git Control.

1. ALWAYS create a new branch when changing the source code.
    a. This ONLY APPLIES for MAJOR or MINOR updates.
    b. PATCH updates MUST be made fully in main branch.
    c. This rule ONLY APPLIES if you ARE in a main or master branch.
    d. Run git status. If you ARE in main/master and is NOT a PATCH update, create a new branch. If you ARE NOT in branch main/master, stay on it.
    e. NEVER change your branch back to main/master. The only thing you can do is change FROM main/master TO ANOTHER ONE, but NEVER the opposite (even if it is a PATCH or bug-fix update).