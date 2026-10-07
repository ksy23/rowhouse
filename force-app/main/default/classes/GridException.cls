/**
 * The one exception Rowhouse throws on purpose.
 *
 * HR-1: it is public, not global, so subscribers cannot catch it by type — they
 * catch bare Exception. That makes the MESSAGE the only diagnostic they get, so
 * every throw site names the object, field or record it is about.
 */
public with sharing class GridException extends Exception {}
