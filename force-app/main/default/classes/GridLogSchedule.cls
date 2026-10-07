/**
 * GridLogSchedule — the alarm clock for the Grid Edit Log's nightly clean-up.
 * GridLogRetention schedules it at 2 AM when an admin saves a period;
 * each night it wakes GridLogRetention, which does the night's work.
 *
 * DO NOT CHANGE THIS CLASS, AND DO NOT NAME ANOTHER ROWHOUSE CLASS IN IT.
 * While a job is scheduled, Salesforce refuses to deploy the scheduled class
 * and every class it names in its code ("This schedulable class has jobs
 * pending or in progress"). Naming GridLogRetention here would lock it, and
 * through it GridSecurity and most of Rowhouse, for as long as the clean-up is
 * on. So GridLogRetention is found by its name, as text, which Salesforce does
 * not count as naming it; this class itself stays locked and never needs to
 * change. A check in scripts/checks/run-all.js holds it to this.
 */
public with sharing class GridLogSchedule implements Schedulable {
    public void execute(SchedulableContext context) {
        // This class's namespace, if Rowhouse is installed with one, so the
        // name is found in Rowhouse and not in the org's own code.
        String self = GridLogSchedule.class.getName();
        String namespace = self.contains('.') ? self.substringBefore('.') : '';
        Type night = Type.forName(namespace, 'GridLogRetention');
        ((Schedulable) night.newInstance()).execute(context);
    }
}
